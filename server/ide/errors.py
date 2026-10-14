"""Errors the router turns into HTTP statuses."""


class NotFound(KeyError):
    """404"""


class BadRequest(ValueError):
    """400"""


class Conflict(Exception):
    """409: the file changed on disk since the client read it"""
