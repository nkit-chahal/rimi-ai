"""Print Advisor route: analyze a pattern image and recommend print methods."""
import os
from flask import Blueprint, request, jsonify

from config import UPLOAD_DIR, RESULTS_DIR
from print_advisor import analyze_pattern_for_printing

bp = Blueprint('print_advisor', __name__)


# --------------- Print Advisor ---------------
@bp.route('/api/print-advisor', methods=['POST'])
def print_advisor_api():
    """
    Analyze a pattern image and recommend print methods.
    Expects JSON: { filename, fabricType, productionVolume, projectId, userId }
    """
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Request body is required'}), 400

    filename = data.get('filename', '')
    fabric_type = data.get('fabricType')
    production_volume = data.get('productionVolume')
    project_id = data.get('projectId', 1)
    user_id = data.get('userId')

    if not filename:
        return jsonify({'success': False, 'error': 'filename is required'}), 400

    # Resolve file path from uploads or results directory
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(RESULTS_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'success': False, 'error': 'File not found'}), 404

    # Parse production volume to int if provided
    if production_volume is not None:
        try:
            production_volume = int(production_volume)
        except (ValueError, TypeError):
            production_volume = None

    try:
        result = analyze_pattern_for_printing(filepath, fabric_type, production_volume)

        # Convert to camelCase for the frontend
        analysis = {
            'colorCount': result['color_count'],
            'hasGradients': result['has_gradients'],
            'gradientScore': result['gradient_score'],
            'minFeatureSize': result['min_feature_size'],
            'detailLevel': result['detail_level'],
            'hasTransparency': result['has_transparency'],
            'recommendations': [
                {
                    'method': rec['method'],
                    'methodKey': rec['method_key'],
                    'score': rec['score'],
                    'reasoning': rec['reasoning'],
                    'costEstimate': rec['cost_estimate'],
                    'minOrder': rec['min_order'],
                    'filePrep': {
                        'colorMode': rec['file_prep']['color_mode'],
                        'fileFormat': rec['file_prep']['file_format'],
                        'resolution': rec['file_prep']['resolution'],
                        'notes': rec['file_prep']['notes'],
                    },
                }
                for rec in result['recommendations']
            ],
        }

        return jsonify({'success': True, 'analysis': analysis})
    except Exception as e:
        print(f"  [Print Advisor] Error: {e}")
        return jsonify({'success': False, 'error': f'Analysis failed: {str(e)}'}), 500
