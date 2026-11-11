# Panduan Arsitektur Backend & Database Galeri Sriwedari

Folder `backend/` ini memisahkan seluruh logika **sisi server (Backend)** dari antarmuka pengguna (Frontend), sehingga struktur kode rapi, terisolasi, dan mudah dipahami.

---

## 📁 Struktur Direktori Backend

```
backend/
├── database/               # 📦 Mesin Database & Layanan Data
│   ├── server-db.ts        # Service database (CRUD, Ledger Stok, Hold Expiry)
│   └── seed-data.ts        # Data awal/bibit untuk inisialisasi pertama
├── security/               # 🔒 Kriptografi & Keamanan Sesi
│   └── session.ts          # Hashing PBKDF2 SHA-256, HMAC Session & RBAC Guard
├── index.ts                # 🚀 Entrypoint ekspor utama backend
└── README.md               # Dokumentasi arsitektur ini
```

---

## 🗄️ Di Mana Data Fisiknya Disimpan?

* **File Database Utama**: [`data/sriwedari-db.json`](../data/sriwedari-db.json)
  * Berkas JSON lokal ini bertindak sebagai database persisten server.
  * Berkas ini diatur dalam `.gitignore` agar tidak bocor ke repositori publik GitHub.
* **Template Contoh**: [`data/sriwedari-db.example.json`](../data/sriwedari-db.example.json)
  * Template bersih untuk deployment awal.

---

## 🔄 Bagaimana Hubungan Frontend dan Backend?

1. **Frontend (Tampilan Pengguna & Admin)**:
   - Terletak di `app/(frontend)/` (halaman publik pengunjung) dan `app/admin/` (dashboard kurator).
   - Mengirim permintaan melalui `fetch('/api/...')` ke backend.
2. **API Routes (Jembatan / Controller)**:
   - Terletak di `app/api/...` (misal `/api/orders`, `/api/tickets`, `/api/costumes`).
   - Menerima request dari frontend, memverifikasi sesi melalui `backend/security/session.ts`, dan memanggil fungsi database di `backend/database/server-db.ts`.
3. **Backend Core (`backend/`)**:
   - Memproses logika bisnis, mutasi stok, kalkulasi diskon, validasi tiket, enkripsi password, dan menyimpan perubahan ke file JSON.

