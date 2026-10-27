"""Public entry of the chat agent (task #AI-46). Used by POST /chat (#AI-47, #188).

    agent = ChatAgent(retriever, model=None, checkpointer=None)
    result = await agent.run(session_id, message, location=None, language=None)
    # {"session_id", "answer", "citations": [{"kind", "id", "title"}], "lang",
    #  "intent", "finish_reason", "llm_calls", "tools_called"}

- `retriever`: any `Retriever` (default `NullRetriever` until #AI-45).
- `model`: any LangChain chat model (or object with `ainvoke(messages)`).
  When None, `models.build_chat_model()` runs lazily on the first turn that
  needs the LLM, so construction never needs a key.
- `checkpointer`: LangGraph checkpointer; default in-memory `MemorySaver`.
  Memory is keyed by `session_id` (LangGraph `thread_id`) and trimmed to
  CHAT_MEMORY_TURNS turns.
"""

from typing import Any

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from app.chatbot.graph import rules
from app.chatbot.graph.builder import (
    MAX_LLM_CALLS_PER_TURN,
    build_graph,
    current_location,
)
from app.chatbot.graph.state import new_turn
from app.chatbot.rag.retriever import NullRetriever, Retriever
from app.chatbot.tools.search import build_tools
from app.config import get_settings
from app.moderation.validator import clip, sanitize_text


class ChatAgent:
    def __init__(
        self,
        retriever: Retriever | None = None,
        model: Any = None,
        checkpointer: Any = None,
        *,
        memory_turns: int | None = None,
        city_aliases: dict[str, str] | None = None,
    ) -> None:
        self.retriever = retriever or NullRetriever()
        self._model = model
        self.checkpointer = checkpointer or MemorySaver()
        self.memory_turns = (
            memory_turns if memory_turns is not None else get_settings().chat_memory_turns
        )
        self.tools = build_tools(self.retriever)
        self.graph = build_graph(
            tools=self.tools,
            get_model=self._get_model,
            memory_turns=self.memory_turns,
            checkpointer=self.checkpointer,
            city_aliases=city_aliases,
        )

    def _get_model(self) -> Any:
        if self._model is None:
            from app.chatbot.models import build_chat_model

            self._model = build_chat_model()
        return self._model

    @staticmethod
    def _config(session_id: str) -> dict:
        return {"configurable": {"thread_id": session_id}}

    async def run(
        self,
        session_id: str,
        message: str,
        location: dict | None = None,
        language: str | None = None,
    ) -> dict[str, Any]:
        """Run one turn. `location` ({lat, lng}) is used for `nearby` only and never stored."""
        if not session_id:
            raise ValueError("session_id is required")
        text = clip(sanitize_text(message or ""), rules.MESSAGE_MAX)
        if not text:
            raise ValueError("message is empty")
        lang = language if language in ("vi", "en") else rules.detect_language(text)

        token = current_location.set(
            {"lat": float(location["lat"]), "lng": float(location["lng"])} if location else None
        )
        try:
            state = await self.graph.ainvoke(
                new_turn(session_id, lang, HumanMessage(content=text)),
                self._config(session_id),
            )
        finally:
            current_location.reset(token)

        if state["llm_calls"] > MAX_LLM_CALLS_PER_TURN:  # defensive; the graph enforces it
            raise RuntimeError("chat turn exceeded its LLM budget")
        return {
            "session_id": session_id,
            "answer": state["answer"],
            "citations": state.get("citations", []),
            "lang": state["lang"],
            "intent": state["intent"],
            "finish_reason": state["finish_reason"],
            "llm_calls": state["llm_calls"],
            "tools_called": state.get("tools_called", []),
        }

    async def history(self, session_id: str) -> list[dict[str, str]]:
        """Stored (trimmed) messages of a session, oldest first; [] when unknown."""
        snapshot = await self.graph.aget_state(self._config(session_id))
        messages = (snapshot.values or {}).get("messages", []) if snapshot else []
        out = []
        for m in messages:
            if isinstance(m, HumanMessage):
                out.append({"role": "user", "content": m.content})
            elif isinstance(m, AIMessage):
                out.append({"role": "assistant", "content": m.content})
        return out
