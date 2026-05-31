"""
RIM AI Backend — Thin App Factory
All routes are in backend/routes/, shared logic in config.py, db.py, auth.py.
"""
import os
from flask import Flask
from flask_cors import CORS

from db import init_db
from routes import register_all_blueprints


def create_app():
    app = Flask(__name__)
    CORS(app, resources={r"/*": {"origins": "*"}})

    # Initialize the database (create tables, seed data)
    init_db()

    # Register all route blueprints
    register_all_blueprints(app)

    return app


app = create_app()

if __name__ == '__main__':
    port = int(os.getenv('PORT', 3001))
    print("=" * 50)
    print("  RIM AI Backend — Flask + Replicate")
    print(f"  http://localhost:{port}")
    print("=" * 50)
    app.run(host='0.0.0.0', port=port, debug=(os.getenv('FLASK_ENV') != 'production'))
