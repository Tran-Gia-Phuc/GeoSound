"""App log setup (issue #238): app.* INFO lines must reach the container logs."""

import logging

from app import main


def test_app_logger_has_a_handler_and_the_configured_level():
    app_logger = logging.getLogger("app")
    main.configure_logging("DEBUG")
    try:
        assert app_logger.level == logging.DEBUG
        assert app_logger.handlers
        assert app_logger.propagate  # pytest caplog still sees the records
    finally:
        main.configure_logging(main.settings.ai_log_level)


def test_unknown_level_falls_back_to_info():
    main.configure_logging("loud")
    try:
        assert logging.getLogger("app").level == logging.INFO
    finally:
        main.configure_logging(main.settings.ai_log_level)


def test_configure_logging_is_idempotent():
    main.configure_logging("INFO")
    main.configure_logging("INFO")
    assert len(logging.getLogger("app").handlers) == 1
