"""LangGraph chat graph (task #AI-46, chatbot-architecture.md section 3.2).

    START -> classify --(smalltalk | out_of_scope)--------------------> answer
                 \\--(search | detail | nearby)--> plan -> retrieve --> answer
    answer --(finish_reason = stop)--> cite -> END
    answer --(no_data | refused)-----> END

- classify, plan, retrieve and cite use no LLM.
- answer makes exactly one LLM call for small talk and for questions with
  retrieved data. Out-of-scope questions and empty retrievals get a canned,
  polite answer in the user's language with no LLM call (no quota spent, no
  chance for the model to answer the off-topic question anyway).
- The per-turn LLM budget is MAX_LLM_CALLS_PER_TURN (2); the normal turn uses 1.
- Memory: the checkpointer stores `messages`; after each answer only the last
  `memory_turns` turns are kept, and only those are sent to the model.
"""

import contextvars
import logging
import uuid
from pathlib import Path
from typing import Any, Callable

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    RemoveMessage,
    SystemMessage,
)
from langgraph.graph import END, START, StateGraph

from app.chatbot.graph import rules
from app.chatbot.graph.state import ChatState
from app.llm.errors import LLMBlockedError
from app.moderation.validator import wrap

logger = logging.getLogger(__name__)

MAX_LLM_CALLS_PER_TURN = 2

# Request location of the current turn ({lat, lng} or None). A context
# variable, not a state field, so the checkpointer never stores it.
current_location: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "chat_location", default=None
)

_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "answer_system.txt"
_LANGUAGE_NAMES = {"vi": "Vietnamese", "en": "English"}

CANNED = {
    "out_of_scope": {
        "vi": "Xin lỗi, mình chỉ có thể giúp về các tour và địa điểm công khai trên GeoSound. "
              "Bạn có muốn tìm một tour hay địa điểm nào không?",
        "en": "Sorry, I can only help with public tours and places on GeoSound. "
              "Would you like to find a tour or a place?",
    },
    "no_data": {
        "vi": "Mình chưa tìm thấy tour hay địa điểm phù hợp trên GeoSound. "
              "Bạn thử hỏi theo thành phố, chủ đề hoặc loại tour khác nhé.",
        "en": "I could not find a matching tour or place on GeoSound. "
              "Try asking about another city, topic or tour type.",
    },
    "refused": {
        "vi": "Xin lỗi, mình không thể trả lời câu hỏi này.",
        "en": "Sorry, I can't answer that question.",
    },
}


class LLMBudgetExceededError(RuntimeError):
    """Raised instead of making a third LLM call in one turn."""


def system_prompt(lang: str) -> str:
    template = _PROMPT_PATH.read_text(encoding="utf-8")
    return template.replace("{language_name}", _LANGUAGE_NAMES.get(lang, "English"))


def keep_last_turns(messages: list[BaseMessage], turns: int) -> list[BaseMessage]:
    """The suffix of `messages` that holds the last `turns` user turns."""
    if turns <= 0:
        return []
    starts = [i for i, m in enumerate(messages) if isinstance(m, HumanMessage)]
    if len(starts) <= turns:
        return list(messages)
    return list(messages[starts[-turns]:])


def render_items(items: list[dict]) -> str:
    """Retrieved items as untrusted data: every field goes through validator.wrap."""
    blocks = []
    for item in items:
        body = (
            f"kind: {item['kind']}\n"
            f"id: {item['id']}\n"
            f"title: {item['title']}\n"
            f"text: {item['text']}"
        )
        blocks.append(wrap("item", body))
    return "<items>\n" + "\n".join(blocks) + "\n</items>"


def _content_text(message: Any) -> str:
    content = getattr(message, "content", message)
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and part.get("type") == "text":
                parts.append(str(part.get("text", "")))
        return "".join(parts).strip()
    return ""


def build_graph(
    *,
    tools: dict[str, Any],
    get_model: Callable[[], Any],
    memory_turns: int,
    checkpointer: Any,
    city_aliases: dict[str, str] | None = None,
):
    """Compile the chat graph. `get_model` is called only when an LLM call is needed."""

    async def classify(state: ChatState) -> dict:
        message = state["messages"][-1].content
        intent = rules.classify(message, has_location=current_location.get() is not None)
        return {"intent": intent}

    async def plan(state: ChatState) -> dict:
        message = state["messages"][-1].content
        location = current_location.get() if state["intent"] == "nearby" else None
        filters = rules.build_filters(message, location=location, city_aliases=city_aliases)
        query = rules.make_query(message)
        tool_plan = rules.plan_tool_calls(state["intent"], query, filters, state["lang"])
        if "near" in filters:
            # Keep the radius only: the state is checkpointed, the location must not be.
            filters = {**filters, "near": {"radius_m": filters["near"]["radius_m"]}}
        return {"filters": filters, "query": query, "tool_plan": tool_plan}

    async def retrieve(state: ChatState) -> dict:
        items: list[dict] = []
        called: list[str] = []
        anchor: dict | None = None
        for step in state.get("tool_plan", []):
            name, args = step["name"], dict(step["args"])
            if step.get("role") == "from_anchor":
                if anchor is None:
                    continue
                args["place_id"] = anchor["place_id"]
            elif step.get("role") == "from_location":
                location = current_location.get()
                if location is None:
                    continue
                args.update(lat=location["lat"], lng=location["lng"])
            rows = await tools[name].ainvoke(args)
            called.append(name)
            if step.get("role") == "anchor" and rows:
                anchor = rows[0]
            items.extend(rules.to_item(name, row) for row in rows)
        return {"retrieved": rules.merge_items(items), "tools_called": called}

    async def answer(state: ChatState) -> dict:
        lang = state["lang"]
        intent = state["intent"]
        retrieved = state.get("retrieved", [])
        llm_calls = state.get("llm_calls", 0)

        if intent == "out_of_scope":
            text, finish = CANNED["out_of_scope"][lang], "refused"
        elif intent in rules.DATA_INTENTS and not retrieved:
            text, finish = CANNED["no_data"][lang], "no_data"
        else:
            if llm_calls >= MAX_LLM_CALLS_PER_TURN:
                raise LLMBudgetExceededError("chat turn LLM budget exhausted")
            history = keep_last_turns(state["messages"], memory_turns)[:-1]
            question = state["messages"][-1].content
            prompt = [
                SystemMessage(system_prompt(lang)),
                *history,
                HumanMessage(render_items(retrieved) + "\n" + wrap("question", question)),
            ]
            llm_calls += 1
            try:
                response = await get_model().ainvoke(prompt)
                text = _content_text(response)
            except LLMBlockedError:
                text = ""
            if text:
                finish = "stop"
            else:
                # Gemini returns an empty message when it blocks content: refuse politely,
                # never retry on another provider.
                text, finish = CANNED["refused"][lang], "refused"

        answer_id = str(uuid.uuid4())
        stored = [*state["messages"], AIMessage(content=text, id=answer_id)]
        kept = keep_last_turns(stored, memory_turns)
        dropped = [RemoveMessage(id=m.id) for m in stored[: len(stored) - len(kept)] if m.id]
        logger.info("chat intent=%s finish=%s llm_calls=%d items=%d",
                    intent, finish, llm_calls, len(retrieved))
        return {
            "answer": text,
            "answer_id": answer_id,
            "finish_reason": finish,
            "llm_calls": llm_calls,
            "messages": [*dropped, AIMessage(content=text, id=answer_id)],
        }

    async def cite(state: ChatState) -> dict:
        cleaned, citations = rules.cite(state["answer"], state.get("retrieved", []))
        update: dict = {"citations": citations}
        if cleaned != state["answer"]:
            update["answer"] = cleaned
            # Same id: add_messages replaces the stored answer with the cleaned text.
            update["messages"] = [AIMessage(content=cleaned, id=state["answer_id"])]
        return update

    def after_classify(state: ChatState) -> str:
        return "plan" if state["intent"] in rules.DATA_INTENTS else "answer"

    def after_answer(state: ChatState) -> str:
        return "cite" if state["finish_reason"] == "stop" else END

    graph = StateGraph(ChatState)
    graph.add_node("classify", classify)
    graph.add_node("plan", plan)
    graph.add_node("retrieve", retrieve)
    graph.add_node("answer", answer)
    graph.add_node("cite", cite)
    graph.add_edge(START, "classify")
    graph.add_conditional_edges("classify", after_classify, ["plan", "answer"])
    graph.add_edge("plan", "retrieve")
    graph.add_edge("retrieve", "answer")
    graph.add_conditional_edges("answer", after_answer, ["cite", END])
    graph.add_edge("cite", END)
    return graph.compile(checkpointer=checkpointer)
