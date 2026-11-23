# 💰 notif-countMONEY — Bot Telegram Rekap & Notif SeaBank

Bot Telegram berbasis **Node.js (TypeScript) + SQLite** yang terhubung otomatis ke **email notifikasi SeaBank di Gmail** (via IMAP) untuk:
- Mendeteksi uang masuk & uang keluar SeaBank secara otomatis (Transfer Masuk/Keluar, QRIS, Bunga Harian, Top-Up E-Wallet, dll) tanpa aplikasi tambahan di HP.
- **Ketik Cepat** langsung di chat Telegram tanpa slash (misal `-25k kopi`, `+500k gaji`, `beli 30rb makan`, termasuk **multi-baris sekaligus**).
- Mengirim notifikasi **real-time** ringkas ke Telegram setiap ada transaksi baru.
- Mengirim **rekap harian otomatis** setiap tengah malam (default jam `00:00 WIB`, merekap 24 jam penuh hari yang baru selesai) atau kapan saja lewat `/rekap`.
- Menyimpan riwayat transaksi & saldo saat ini secara permanen di database **SQLite** (built-in `node:sqlite`) dengan sistem anti-duplikat.

---

## 📱 Contoh Tampilan Pesan di Telegram

**Rekap Harian (`/rekap` atau otomatis setiap jam `00:00 WIB`):**
```text
📊 Rekap Keuangan Hari Ini (Senin, 23 Nov 2026)

Anda telah menspend uang Rp 85.000 dan anda telah mendapat uang Rp 150.000 hari ini.
Selisih uang masuk keluar +65.000 rupiah (pendapatan lebih besar 📈)
-> Jumlah uang sekarang: Rp 1.565.000

Ingat hemat! 💡

📝 Transaksi: 3x (1 masuk, 2 keluar)
```

**Notifikasi Real-Time Saat Ada Transaksi Baru:**
```text
💸 Uang Keluar (SeaBank)
Nominal: -Rp 35.000
Keterangan: Pembayaran QRIS Berhasil (ke KOPI KENANGAN)
Waktu: 23 Nov 2026, 14.20 WIB
-> Jumlah uang sekarang: Rp 1.565.000
Sumber: Email SeaBank (ID #4)
```

---

## 🛠️ Persyaratan

- **Node.js v22.5+** (direkomendasikan Node.js v24)
- Akun **Telegram** + Bot Token dari `@BotFather`
- Akun **Gmail** yang terdaftar menerima email notifikasi transaksi dari **SeaBank** + **Gmail App Password**

---

## 🚀 Panduan Setup Langkah demi Langkah

### 1. Aktifkan Notifikasi Email di Aplikasi SeaBank
Pastikan alamat Gmail Anda sudah terdaftar dan notifikasi transaksi via email aktif di aplikasi SeaBank.

### 2. Buat Bot Telegram via `@BotFather`
1. Buka Telegram, cari `@BotFather`.
2. Kirim `/newbot`, ikuti instruksi penamaan bot.
3. Salin **Bot Token** (contoh: `123456789:ABCDEF...`).

### 3. Buat Gmail App Password (16 Karakter)
> ⚠️ Jangan gunakan password login Gmail biasa! Gunakan **App Password** agar aman dan diizinkan oleh Google IMAP.

1. Buka [Google Account Security](https://myaccount.google.com/security).
2. Pastikan **2-Step Verification (Verifikasi 2 Langkah)** sudah **Aktif**.
3. Buka menu **App passwords** (atau cari "App passwords" di kolom pencarian Google Account).
4. Buat nama aplikasi baru, misalnya `SeaBank Telegram Bot`, lalu klik **Create**.
5. Salin 16 karakter App Password yang muncul (contoh: `abcd efgh ijkl mnop`).
6. Pastikan IMAP aktif di Gmail: buka Gmail di browser → **Settings (⚙️)** → **See all settings** → tab **Forwarding and POP/IMAP** → pastikan **Enable IMAP** aktif.

### 4. Instalasi & Konfigurasi Project
```bash
npm install
cp .env.example .env
```
Edit file `.env` dan isi:
- `TELEGRAM_BOT_TOKEN` → token dari `@BotFather`
- `GMAIL_USER` → alamat Gmail Anda
- `GMAIL_APP_PASSWORD` → 16 karakter App Password dari langkah 3
- `TELEGRAM_CHAT_ID` → (boleh dikosongkan dulu di percobaan pertama)

### 5. Jalankan Bot & Dapatkan Chat ID
```bash
npm run dev
```
1. Buka bot Telegram Anda dan kirim `/start`.
2. Bot akan membalas dengan **Chat ID** Anda (misal `987654321`).
3. Masukkan angka tersebut ke `TELEGRAM_CHAT_ID=987654321` di file `.env`, lalu restart bot.
4. Sinkronkan saldo SeaBank Anda saat ini dengan perintah:
   ```text
   /setsaldo 1500000
   ```
   *(ganti `1500000` dengan saldo SeaBank Anda sekarang).*

---

## 📋 Daftar Perintah Bot Telegram

> Lihat panduan lengkap beserta contoh pemakaian & output setiap perintah di [COMMANDS.md](./COMMANDS.md).

| Perintah | Fungsi |
|---|---|
| `/rekap` atau `/hariini` | Lihat rekap uang masuk, keluar, selisih & saldo hari ini |
| `/rekap YYYY-MM-DD` | Lihat rekap untuk tanggal tertentu (misal `/rekap 2026-11-22`) |
| `/bulan` | Lihat rekap total bulan berjalan (atau `/bulan 2026-11`) |
| `/saldo` | Lihat jumlah uang saat ini |
| `/setsaldo <nominal>` | Sinkronkan jumlah uang sekarang dengan saldo SeaBank |
| `/riwayat [jumlah]` | Lihat transaksi terakhir beserta ID-nya (default 10) |
| `/masuk <nominal> [ket]` | Catat uang masuk manual |
| `/keluar <nominal> [ket]` | Catat uang keluar manual |
| `/hapus <id>` | Hapus transaksi berdasarkan ID & kembalikan saldo otomatis |
| `/cekemail` | Paksa cek email SeaBank terbaru di Gmail sekarang juga |
| `/status` | Cek status koneksi Gmail, sync terakhir, jadwal rekap & total transaksi |
| `/simulasi <subject> \| <isi>` | Uji parser email SeaBank tanpa mengubah database/saldo |

---

## ☁️ Cara Deploy 24/7 (Railway / Render / VPS / Docker)

### Build & Jalankan Production
```bash
npm run build
npm start
```

### Menggunakan Docker
```bash
docker build -t notif-count-money .
docker run -d --name seabank-bot --env-file .env -v $(pwd)/data:/app/data notif-count-money
```

### Tips Deploy di Railway / Render
- Push repo ini ke GitHub (pastikan `.env` **tidak** ikut ter-push karena sudah ada di `.gitignore`).
- Hubungkan repo ke Railway / Render, masukkan seluruh variabel `.env` di menu **Environment Variables**.
- Pasang **Persistent Volume** ke `/app/data` agar file SQLite (`finance.db`) tidak hilang saat redeploy.
- Bot juga sudah menyediakan endpoint healthcheck `GET /health` pada `PORT` (default `3000`).

---

## 🧪 Menjalankan Unit Test
```bash
npm test
npm run typecheck
```
