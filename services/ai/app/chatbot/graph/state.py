"""State of the chat graph (task #AI-46, chatbot-architecture.md section 3.1).

Only `messages` (the trimmed conversation) is meant to persist between turns;
every other field is reset by `ChatAgent.run` at the start of a turn. The
request location is NOT a state field: it is passed through a context variable
so the checkpointer never stores it (section 8: "never stored").
"""

from typing import Annotated, Any, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


class ChatState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    session_id: str
    lang: str  # "vi" | "en"
    intent: str  # search | detail | nearby | smalltalk | out_of_scope
    query: str
    filters: dict[str, Any]
    tool_plan: list[dict[str, Any]]
    tools_called: list[str]
    retrieved: list[dict[str, Any]]
    answer: str
    answer_id: str
    citations: list[dict[str, str]]
    llm_calls: int
    finish_reason: str  # stop | no_data | refused


def new_turn(session_id: str, lang: str, user_message: Any) -> ChatState:
    """Input of one turn: the new user message plus every per-turn field reset."""
    return {
        "messages": [user_message],
        "session_id": session_id,
        "lang": lang,
        "intent": "",
        "query": "",
        "filters": {},
        "tool_plan": [],
        "tools_called": [],
        "retrieved": [],
        "answer": "",
        "answer_id": "",
        "citations": [],
        "llm_calls": 0,
        "finish_reason": "",
    }
