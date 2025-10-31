import math
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional

import firebase_admin
from firebase_admin import credentials, firestore
from flask import Flask, jsonify, render_template, request

# --- Application Setup ---
app = Flask(__name__)

# --- Data Classes ---
@dataclass
class Coords:
    """A simple data class for geographic coordinates."""
    lat: float
    lon: float

# --- Service Managers ---
class FirestoreManager:
    """Handles all interactions with the Firestore database."""
    def __init__(self):
        """Initializes the Firestore client and handles credentials."""
        try:
            # It's recommended to use environment variables for credentials in production
            cred = credentials.Certificate("serviceAccountKey.json")
            if not firebase_admin._apps:
                firebase_admin.initialize_app(cred)
            self.db = firestore.client()
            app.logger.info("✅ Firebase connection successful.")
        except Exception as e:
            app.logger.error(f"🔥 Firebase connection failed: {e}")
            self.db = None

    def is_active(self) -> bool:
        """Checks if the database client is initialized."""
        return self.db is not None

    def update_user_location(self, user_id: str, status: str, coords: Coords) -> None:
        """Sets or updates a user's status, location, and last seen timestamp."""
        user_ref = self.db.collection('users').document(user_id)
        user_ref.set({
            'status': status,
            'location': firestore.GeoPoint(coords.lat, coords.lon),
            'lastSeen': time.time()
        }, merge=True)

    def get_user_data(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a user's document data by their ID."""
        doc = self.db.collection('users').document(user_id).get()
        return doc.to_dict() if doc.exists else None

    def find_closest_online_partner(self, user_id: str, user_coords: Coords) -> Optional[Dict[str, Any]]:
        """Finds the nearest available user with 'online' status."""
        self.cleanup_stale_users()
        users_ref = self.db.collection('users')
        # Query for users who are online, excluding the current user.
        query = users_ref.where('status', '==', 'online').limit(50)
        online_users = [doc for doc in query.stream() if doc.id != user_id]

        if not online_users:
            return None

        closest_partner = None
        min_distance = float('inf')

        for partner_doc in online_users:
            partner_data = partner_doc.to_dict()
            loc = partner_data.get('location')
            if loc:
                distance = haversine_distance(user_coords, Coords(loc.latitude, loc.longitude))
                if distance < min_distance:
                    min_distance = distance
                    closest_partner = {'id': partner_doc.id, 'data': partner_data}
        return closest_partner

    def create_match(self, user_id: str, partner_id: str) -> None:
        """Atomically updates both users to a 'matched' status using a batch write."""
        batch = self.db.batch()
        user_ref = self.db.collection('users').document(user_id)
        partner_ref = self.db.collection('users').document(partner_id)
        
        match_data = {'status': 'matched'}
        batch.update(user_ref, {**match_data, 'partnerId': partner_id})
        batch.update(partner_ref, {**match_data, 'partnerId': user_id})
        batch.commit()

    def end_match(self, user_id: str, partner_id: str) -> None:
        """Atomically removes match data for both users and sets them to 'offline'."""
        batch = self.db.batch()
        user_ref = self.db.collection('users').document(user_id)
        partner_ref = self.db.collection('users').document(partner_id)
        
        offline_data = {'status': 'offline', 'partnerId': firestore.DELETE_FIELD}
        batch.update(user_ref, offline_data)
        batch.update(partner_ref, offline_data)
        batch.commit()
    
    def set_user_status(self, user_id: str, status: str) -> None:
        """Sets a user's status field (e.g., to 'ringing')."""
        user_ref = self.db.collection('users').document(user_id)
        user_ref.update({'status': status})

    def cleanup_stale_users(self, expiry_seconds: int = 300) -> None:
        """Deletes user documents that haven't been updated recently."""
        stale_threshold = time.time() - expiry_seconds
        stale_users = self.db.collection('users').where('lastSeen', '<', stale_threshold).stream()
        deleted_count = 0
        for user in stale_users:
            user.reference.delete()
            deleted_count += 1
        if deleted_count > 0:
            app.logger.info(f"Cleaned up {deleted_count} stale users.")

# --- Globals & Helpers ---
db_manager = FirestoreManager()

def haversine_distance(c1: Coords, c2: Coords) -> float:
    """Calculates the distance between two lat/lon coordinates in kilometers."""
    R = 6371  # Earth's radius in km
    dlat = math.radians(c2.lat - c1.lat)
    dlon = math.radians(c2.lon - c1.lon)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(c1.lat)) * math.cos(math.radians(c2.lat)) *
         math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

# --- Flask Routes ---
@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

@app.route('/update-location', methods=['POST'])
def update_location():
    """Updates a user's location and status (online, offline, matched)."""
    if not db_manager.is_active(): return jsonify({'status': 'error', 'message': 'Database not configured'}), 500
    
    data = request.get_json()
    if not data or not data.get('userId') or not data.get('status'):
        return jsonify({'status': 'error', 'message': 'Missing required fields: userId, status'}), 400

    coords = Coords(lat=data.get('lat', 0), lon=data.get('lon', 0))
    db_manager.update_user_location(data['userId'], data['status'], coords)
    return jsonify({'status': 'success'})

@app.route('/find-partner', methods=['POST'])
def find_partner():
    """Finds the closest available partner and creates a match."""
    if not db_manager.is_active(): return jsonify({'status': 'error', 'message': 'Database not configured'}), 500

    data = request.get_json()
    if not data or not all(k in data for k in ['userId', 'lat', 'lon']):
        return jsonify({'status': 'error', 'message': 'Missing required fields: userId, lat, lon'}), 400

    user_coords = Coords(lat=data['lat'], lon=data['lon'])
    partner = db_manager.find_closest_online_partner(data['userId'], user_coords)
    
    if not partner:
        return jsonify({'status': 'no_partner_found'})
        
    db_manager.create_match(data['userId'], partner['id'])
    return jsonify({'status': 'matched', 'partnerId': partner['id']})

@app.route('/ring-partner', methods=['POST'])
def ring_partner():
    """Sets a partner's status to 'ringing' to notify them."""
    if not db_manager.is_active(): return jsonify({'status': 'error', 'message': 'Database not configured'}), 500
    
    data = request.get_json()
    partner_id = data.get('partnerId')
    if not partner_id:
        return jsonify({'status': 'error', 'message': 'Partner ID is required'}), 400

    db_manager.set_user_status(partner_id, 'ringing')
    return jsonify({'status': 'success', 'message': f"Ringing user {partner_id}"})

@app.route('/check-status', methods=['POST'])
def check_status():
    """Checks a user's status; includes partner location if matched."""
    if not db_manager.is_active(): return jsonify({'status': 'error', 'message': 'Database not configured'}), 500
    
    data = request.get_json()
    user_id = data.get('userId')
    if not user_id:
        return jsonify({'status': 'error', 'message': 'User ID is required'}), 400

    user_data = db_manager.get_user_data(user_id)
    if not user_data:
        return jsonify({'status': 'not_found'})
    
    # If matched, embed partner's location to prevent a race condition on the client
    if user_data.get('status') == 'matched':
        partner_id = user_data.get('partnerId')
        if partner_id:
            partner_data = db_manager.get_user_data(partner_id)
            if partner_data and 'location' in partner_data:
                loc = partner_data['location']
                user_data['partnerLocation'] = {'lat': loc.latitude, 'lon': loc.longitude}
        
    # Serialize GeoPoint for JSON response
    if 'location' in user_data and isinstance(user_data['location'], firestore.GeoPoint):
        loc = user_data['location']
        user_data['location'] = {'latitude': loc.latitude, 'longitude': loc.longitude}
        
    return jsonify(user_data)

@app.route('/get-partner-location', methods=['POST'])
def get_partner_location():
    """Retrieves the current location of a given partner ID."""
    if not db_manager.is_active(): return jsonify({'status': 'error', 'message': 'Database not configured'}), 500
    
    data = request.get_json()
    partner_id = data.get('partnerId')
    if not partner_id:
        return jsonify({'status': 'error', 'message': 'Partner ID is required'}), 400

    partner_data = db_manager.get_user_data(partner_id)
    if not partner_data or 'location' not in partner_data:
        return jsonify({'status': 'error', 'message': 'Partner location not available'}), 404
        
    loc = partner_data['location']
    return jsonify({'lat': loc.latitude, 'lon': loc.longitude})

@app.route('/exit-match', methods=['POST'])
def exit_match():
    """Ends a match between two users."""
    if not db_manager.is_active(): return jsonify({'status': 'error', 'message': 'Database not configured'}), 500
    
    data = request.get_json()
    if not data or not all(k in data for k in ['userId', 'partnerId']):
        return jsonify({'status': 'error', 'message': 'Missing required fields: userId, partnerId'}), 400

    db_manager.end_match(data['userId'], data['partnerId'])
    return jsonify({'status': 'success'})

if __name__ == '__main__':
    # Use host='0.0.0.0' to make the server accessible on your local network
    app.run(host='0.0.0.0', port=5000, debug=True)