"""
Blueprint registry — imports all route modules and registers them with the Flask app.
"""


def register_all_blueprints(app):
    from routes.studio import bp as studio_bp
    from routes.upload import bp as upload_bp
    from routes.color import bp as color_bp
    from routes.generation import bp as generation_bp
    from routes.seamless import bp as seamless_bp
    from routes.repeat import bp as repeat_bp
    from routes.vectorize import bp as vectorize_bp
    from routes.layers import bp as layers_bp
    from routes.mockups import bp as mockups_bp
    from routes.colorways import bp as colorways_bp
    from routes.exports import bp as exports_bp
    from routes.pipeline import bp as pipeline_bp
    from routes.projects import bp as projects_bp
    from routes.print_advisor_routes import bp as print_advisor_bp
    from routes.admin import bp as admin_bp

    for blueprint in [
        studio_bp, upload_bp, color_bp, generation_bp, seamless_bp,
        repeat_bp, vectorize_bp, layers_bp, mockups_bp, colorways_bp,
        exports_bp, pipeline_bp, projects_bp, print_advisor_bp, admin_bp,
    ]:
        app.register_blueprint(blueprint)
