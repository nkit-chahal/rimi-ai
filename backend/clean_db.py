import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'rimi_ai.sqlite3')
conn = sqlite3.connect(DB_PATH)
conn.execute("DELETE FROM pattern_variations WHERE image_url IN ('/demo_floral.png', '/demo_botanical.png', '/demo_geometric.png')")
conn.commit()
conn.close()
print("Cleaned hardcoded variations.")
