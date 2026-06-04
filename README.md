# WhatsApp Bulk Messaging Bot MVP

This is the WhatsApp Bulk Messaging Bot MVP designed to send personalized property rental messages sequentially using contacts from Excel/CSV files via the local OpenWA Gateway.

## Features
* **Excel / CSV Leads Upload**: Parses Name and Phone Number columns (case-insensitive column matching).
* **Personalized Templates**: Supports dynamic replacement of `{{name}}`.
* **WhatsApp Session status**: Connects to the local OpenWA instance, retrieves QR code, and tracks status.
* **Campaign Console**: Configurable sequential delay (e.g. 5 seconds) to prevent spam detection, with live progress meters (Total, Sent, Failed, Pending) and a live logs console.
* **Local Database**: Built on a single local JSON file (`data/bot-db.json`) for zero configuration and easy database maintenance.

## Tech Stack
* **Backend**: Node.js & Express
* **File Processing**: `xlsx` (reads Excel and CSV formats directly into memory)
* **WhatsApp Bridge**: HTTP API client interacting with local OpenWA REST endpoints.
* **Frontend**: Vanilla CSS Glassmorphism dashboard (no build step needed).

## Getting Started

### 1. Start the OpenWA Gateway
Make sure you run OpenWA first on its default port `2785`:
```bash
# In the OpenWA root folder:
npm install
npm run dev
```

### 2. Start the Bulk Messaging Bot
In a separate terminal, navigate to the `OpenWA-bot` folder:
```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Open your browser and navigate to `http://localhost:34567`.
- Click **Connect** to initialize the WhatsApp session.
- Scan the printed QR code with your phone.
- Upload your Excel/CSV sheet.
- Type/Save your template.
- Enter your desired sending delay.
- Click **Start Campaign**!
