from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash
from functools import wraps
from datetime import datetime, timedelta, timezone
import os, uuid, secrets, hashlib, base64, json
from cryptography.fernet import Fernet, InvalidToken

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, 'frontend')
app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'local-practice-secret-change-me')
_cors_origins = os.environ.get('CORS_ORIGINS', '*')
if _cors_origins != '*':
    _cors_origins = [origin.strip() for origin in _cors_origins.split(',') if origin.strip()]
CORS(app, resources={r'/api/*': {'origins': _cors_origins}}, supports_credentials=False)

# In-memory store: data resets whenever the process restarts. This is intentional for a practice lab.
items = []
otp_sessions = {}
tokens = {}
next_id = 1
DEMO_EMAIL = os.environ.get('DEMO_EMAIL', 'learner@example.com')
DEMO_PASSWORD = os.environ.get('DEMO_PASSWORD', 'Practice@123')


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def error(message, status=400, **extra):
    return jsonify({'success': False, 'error': message, **extra}), status


def bearer_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return error('Missing Bearer token. Login first.', 401)
        token = auth[7:].strip()
        record = tokens.get(token)
        if not record or record['expires_at'] < datetime.now(timezone.utc):
            return error('Invalid or expired token.', 401)
        request.user = record['email']
        return fn(*args, **kwargs)
    return wrapper


def payload_json():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None
    return data


def session_fernet(session_id):
    # Derive a per-session Fernet key. This is for learning only, not production key management.
    digest = hashlib.sha256((app.config['SECRET_KEY'] + ':' + session_id).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


@app.get('/')
def home():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.get('/health')
def health():
    return jsonify({'success': True, 'service': 'API Practice Lab', 'timestamp': now_iso()})

# CRUD API ------------------------------------------------------------------
@app.get('/api/items')
def list_items():
    return jsonify({'success': True, 'count': len(items), 'data': items})

@app.get('/api/items/<int:item_id>')
def get_item(item_id):
    item = next((x for x in items if x['id'] == item_id), None)
    return jsonify({'success': True, 'data': item}) if item else error('Item not found.', 404)

@app.post('/api/items')
def create_item():
    global next_id
    data = payload_json()
    if data is None:
        return error('Send a JSON object in the request body.')
    name = str(data.get('name', '')).strip()
    category = str(data.get('category', 'General')).strip() or 'General'
    try:
        quantity = int(data.get('quantity', 1))
        price = float(data.get('price', 0))
    except (ValueError, TypeError):
        return error('quantity must be an integer and price must be numeric.')
    if not name:
        return error('name is required.')
    if quantity < 0 or price < 0:
        return error('quantity and price must be zero or greater.')
    item = {'id': next_id, 'name': name, 'category': category, 'quantity': quantity,
            'price': round(price, 2), 'created_at': now_iso(), 'updated_at': now_iso()}
    next_id += 1
    items.append(item)
    return jsonify({'success': True, 'message': 'Item created.', 'data': item}), 201

@app.put('/api/items/<int:item_id>')
def replace_item(item_id):
    data = payload_json()
    if data is None:
        return error('Send a JSON object in the request body.')
    item = next((x for x in items if x['id'] == item_id), None)
    if not item:
        return error('Item not found.', 404)
    name = str(data.get('name', '')).strip()
    if not name:
        return error('name is required for PUT.')
    try:
        quantity = int(data.get('quantity', 1))
        price = float(data.get('price', 0))
    except (ValueError, TypeError):
        return error('quantity must be an integer and price must be numeric.')
    if quantity < 0 or price < 0:
        return error('quantity and price must be zero or greater.')
    item.update({'name': name, 'category': str(data.get('category', 'General')).strip() or 'General',
                 'quantity': quantity, 'price': round(price, 2), 'updated_at': now_iso()})
    return jsonify({'success': True, 'message': 'Item replaced.', 'data': item})

@app.patch('/api/items/<int:item_id>')
def update_item(item_id):
    data = payload_json()
    if data is None:
        return error('Send a JSON object in the request body.')
    item = next((x for x in items if x['id'] == item_id), None)
    if not item:
        return error('Item not found.', 404)
    allowed = {'name', 'category', 'quantity', 'price'}
    unknown = set(data) - allowed
    if unknown:
        return error('Unsupported field(s).', fields=sorted(unknown))
    if 'name' in data and not str(data['name']).strip():
        return error('name cannot be empty.')
    try:
        if 'quantity' in data: data['quantity'] = int(data['quantity'])
        if 'price' in data: data['price'] = round(float(data['price']), 2)
    except (ValueError, TypeError):
        return error('quantity must be an integer and price must be numeric.')
    if data.get('quantity', 0) < 0 or data.get('price', 0) < 0:
        return error('quantity and price must be zero or greater.')
    item.update(data)
    item['updated_at'] = now_iso()
    return jsonify({'success': True, 'message': 'Item updated.', 'data': item})

@app.delete('/api/items/<int:item_id>')
def delete_item(item_id):
    index = next((i for i, x in enumerate(items) if x['id'] == item_id), None)
    if index is None:
        return error('Item not found.', 404)
    deleted = items.pop(index)
    return jsonify({'success': True, 'message': 'Item deleted.', 'data': deleted})

@app.post('/api/items/reset')
def reset_items():
    global next_id
    items.clear(); next_id = 1
    return jsonify({'success': True, 'message': 'All practice items cleared.'})

# OTP authentication ---------------------------------------------------------
def valid_mobile(mobile):
    return isinstance(mobile, str) and len(mobile) == 10 and mobile.isdigit() and mobile[0] in '6789'

@app.post('/api/auth/otp/send')
def send_otp():
    data = payload_json()
    if data is None:
        return error('Send JSON with mobile, e.g. {"mobile":"9876543210"}.')
    mobile = str(data.get('mobile', '')).strip()
    if not valid_mobile(mobile):
        return error('Invalid mobile number. Enter exactly 10 digits starting with 6, 7, 8 or 9.', 422)
    session_id = str(uuid.uuid4())
    otp = f'{secrets.randbelow(1_000_000):06d}'
    encrypted = session_fernet(session_id).encrypt(otp.encode()).decode()
    otp_sessions[session_id] = {'mobile': mobile, 'encrypted_otp': encrypted,
                                'created_at': datetime.now(timezone.utc), 'attempts': 0, 'used': False}
    return jsonify({'success': True, 'message': 'Practice OTP generated. Use the session_id with the OTP retrieval API.',
                    'session_id': session_id, 'expires_in_seconds': 300}), 201

@app.post('/api/auth/otp/get')
def get_otp():
    data = payload_json()
    session_id = str((data or {}).get('session_id', '')).strip()
    record = otp_sessions.get(session_id)
    if not record:
        return error('Unknown session_id.', 404)
    if record['used']:
        return error('This OTP session has already been used.', 409)
    if datetime.now(timezone.utc) - record['created_at'] > timedelta(minutes=5):
        return error('OTP expired. Request a new OTP.', 410)
    try:
        otp = session_fernet(session_id).decrypt(record['encrypted_otp'].encode()).decode()
    except (InvalidToken, ValueError):
        return error('OTP could not be decrypted for this session.', 500)
    return jsonify({'success': True, 'session_id': session_id, 'otp': otp,
                    'expires_in_seconds': max(0, 300 - int((datetime.now(timezone.utc)-record['created_at']).total_seconds()))})

@app.post('/api/auth/otp/verify')
def verify_otp():
    data = payload_json()
    if data is None: return error('Send session_id and otp in JSON.')
    session_id = str(data.get('session_id', '')).strip()
    otp = str(data.get('otp', '')).strip()
    record = otp_sessions.get(session_id)
    if not record: return error('Unknown session_id.', 404)
    if record['used']: return error('OTP session already used.', 409)
    if datetime.now(timezone.utc) - record['created_at'] > timedelta(minutes=5): return error('OTP expired.', 410)
    record['attempts'] += 1
    if record['attempts'] > 5: return error('Too many attempts. Request a new OTP.', 429)
    expected = session_fernet(session_id).decrypt(record['encrypted_otp'].encode()).decode()
    if not secrets.compare_digest(otp, expected): return error('Incorrect OTP.', 401, attempts_remaining=max(0, 5-record['attempts']))
    record['used'] = True
    token = secrets.token_urlsafe(32)
    tokens[token] = {'email': record['mobile'], 'expires_at': datetime.now(timezone.utc) + timedelta(hours=1)}
    return jsonify({'success': True, 'message': 'OTP login successful.', 'token': token,
                    'token_type': 'Bearer', 'expires_in_seconds': 3600,
                    'user': {'mobile': record['mobile'], 'auth_method': 'otp'}})

# Username/password API login -----------------------------------------------
@app.post('/api/auth/login')
def api_login():
    data = payload_json()
    if data is None: return error('Send email and password in JSON.')
    email = str(data.get('email', '')).strip().lower()
    password = str(data.get('password', ''))
    if email != DEMO_EMAIL.lower() or not secrets.compare_digest(password, DEMO_PASSWORD):
        return error('Invalid email or password.', 401)
    token = secrets.token_urlsafe(32)
    tokens[token] = {'email': email, 'expires_at': datetime.now(timezone.utc) + timedelta(hours=1)}
    return jsonify({'success': True, 'message': 'Login successful.', 'token': token,
                    'token_type': 'Bearer', 'expires_in_seconds': 3600,
                    'user': {'email': email, 'auth_method': 'password'}})

@app.get('/api/auth/me')
@bearer_required
def auth_me():
    return jsonify({'success': True, 'user': {'identity': request.user}})

@app.post('/api/auth/logout')
@bearer_required
def auth_logout():
    token = request.headers.get('Authorization', '')[7:].strip()
    tokens.pop(token, None)
    return jsonify({'success': True, 'message': 'Logged out.'})

@app.get('/api/docs')
def api_docs():
    return jsonify({'service': 'API Practice Lab', 'note': 'Educational demo only; in-memory storage; not for production.',
      'demo_credentials': {'email': DEMO_EMAIL, 'password': DEMO_PASSWORD},
      'endpoints': [
        {'method':'GET','path':'/api/items','description':'List all rows'},
        {'method':'GET','path':'/api/items/{id}','description':'Get one row'},
        {'method':'POST','path':'/api/items','description':'Create a row'},
        {'method':'PUT','path':'/api/items/{id}','description':'Replace a row'},
        {'method':'PATCH','path':'/api/items/{id}','description':'Partially update a row'},
        {'method':'DELETE','path':'/api/items/{id}','description':'Delete a row'},
        {'method':'POST','path':'/api/items/reset','description':'Clear all rows'},
        {'method':'POST','path':'/api/auth/otp/send','description':'Generate OTP and session_id'},
        {'method':'POST','path':'/api/auth/otp/get','description':'Retrieve/decrypt OTP using session_id'},
        {'method':'POST','path':'/api/auth/otp/verify','description':'Verify OTP and return bearer token'},
        {'method':'POST','path':'/api/auth/login','description':'Email/password login and return bearer token'},
        {'method':'GET','path':'/api/auth/me','description':'Protected endpoint; requires Bearer token'},
        {'method':'POST','path':'/api/auth/logout','description':'Invalidate bearer token'}]})

@app.errorhandler(404)
def not_found(_):
    if request.path.startswith('/api/'): return error('API endpoint not found.', 404)
    return send_from_directory(FRONTEND_DIR, 'index.html')

if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('FLASK_DEBUG') == '1')
