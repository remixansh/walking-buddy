# 🚶‍♂️ Walking Buddy App (Flask + Firebase)

**Walking Buddy** is a real-time location-based web app that helps users **find nearby walking partners** using their GPS location.  
It automatically connects users who are online and close to each other, allowing them to coordinate walks and stay connected in real time.

---

## 🌟 Key Features

- 📍 **Live Location Tracking** — Continuously updates each user’s latitude and longitude.  
- 🤝 **Find Nearby Walkers** — Matches you with the closest online walking buddy.  
- 🔔 **Ringing Alerts** — Notifies your partner when a connection request is sent.  
- 🧭 **Live Partner Location** — See your buddy’s location while walking together.  
- 🧹 **Auto Cleanup** — Removes inactive users after 5 minutes to keep data fresh.  
- 🔥 **Cloud-Based Database** using Firebase Firestore.  

---

## 🧩 Tech Stack

| Component | Technology |
|------------|-------------|
| Backend Framework | Flask |
| Database | Firebase Firestore |
| Authentication | Firebase Admin SDK |
| Language | Python 3 |
| Deployment | Localhost / Cloud (Render, Railway, etc.) |

---

## 🛠️ Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/remixansh/walking-buddy.git
cd walking-buddy
```

### 2. Create and Activate a Virtual Environment
```bash
python -m venv venv
source venv/bin/activate      # For macOS/Linux
venv\Scripts\activate         # For Windows
```

### 3. Install Dependencies
```bash
pip install flask firebase-admin
```

### 4. Configure Firebase
1. Go to the [Firebase Console](https://console.firebase.google.com/)  
2. Create a new project and enable **Firestore Database**  
3. Generate a **Service Account Key** under  
   `Project Settings → Service Accounts → Generate New Private Key`
4. Save it as `serviceAccountKey.json` in the root folder of your project

### 5. Run the App
```bash
python app.py
```
Now open your browser at:
```
http://127.0.0.1:5000/
```
To make it visible on your local network:
```bash
python app.py --host=0.0.0.0
```

---

## 🌐 API Endpoints

| Endpoint | Method | Description |
|-----------|--------|-------------|
| `/update-location` | POST | Update user’s live location and status |
| `/find-partner` | POST | Find the nearest online walking buddy |
| `/ring-partner` | POST | Notify the selected walking partner |
| `/check-status` | POST | Get user’s current status and partner info |
| `/get-partner-location` | POST | Retrieve partner’s live location |
| `/exit-match` | POST | End the walk and set both users offline |

---


## 📂 Project Structure

```
├── app.py    
├── static/
│   └── script.js 
│   └── style.css              # Main Flask backend
├── templates/
│   └── index.html           # Frontend interface (optional)
├── serviceAccountKey.json   # Firebase credentials (excluded from repo)
└── README.md                # Documentation
```

---

## 💡 Future Enhancements (Soon)

- 🗺️ Integrate Google Maps or Leaflet for visual tracking  
- 📱 Add a mobile-friendly UI with live distance updates  
- 💬 Include a simple chat or ping system  
- 🔒 Add user authentication (Google/Firebase Auth)

---

## 👨‍💻 Author

**Ansh Raj**  
🎓 B.Tech CSE 
📍 Delhi, India  
💬 Passionate about creative digital solutions and community-driven apps  

---

## 🪪 License

This project is open-source and available under the **MIT License**.

---

> 🚶‍♀️ *Find your perfect walking companion — stay active, stay connected!*
