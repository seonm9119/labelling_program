"""Compatibility entrypoint for local and Docker execution."""

from backend.app import app, run_server


if __name__ == '__main__':
    run_server()
