# 📋 Panduan Lengkap Perintah Bot Telegram (`notif-countMONEY`)

Dokumentasi ini berisi **seluruh perintah** yang tersedia pada bot Telegram pencatat keuangan SeaBank (`@AiSales_Aegis_bot`), lengkap dengan format, parameter, contoh pemakaian, dan penjelasan perilakunya.

---

## ⚡ Ringkasan Cepat

| Perintah | Alias | Fungsi Singkat |
|---|---|---|
| `/start` | `/help` | Menampilkan daftar perintah & Chat ID (jika belum dikonfigurasi) |
| `/rekap [YYYY-MM-DD]` | `/hariini` | Rekap uang keluar, uang masuk, selisih & saldo sekarang |
| `/bulan [YYYY-MM]` | — | Rekap total pemasukan, pengeluaran & selisih bulanan |
| `/saldo` | — | Melihat jumlah uang saat ini |
| `/setsaldo <nominal>` | — | Mengatur / menyinkronkan jumlah uang sekarang |
| `/riwayat [jumlah]` | — | Menampilkan daftar transaksi terakhir beserta ID-nya |
| `/masuk <nominal> [ket]` | — | Mencatat uang masuk secara manual |
| `/keluar <nominal> [ket]` | — | Mencatat uang keluar secara manual |
| `/hapus <id>` | — | Menghapus transaksi berdasarkan ID & mengembalikan saldo otomatis |
| `/cekemail` | — | Memaksa bot mengecek email notifikasi SeaBank di Gmail sekarang |
| `/status` | — | Menampilkan status koneksi Gmail, sync terakhir, jadwal rekap & saldo |
| `/simulasi <subject> \| <isi>` | — | Menguji parser email SeaBank tanpa mengubah saldo/database |

> **Catatan Format Nominal:** Pada perintah `/setsaldo`, `/masuk`, dan `/keluar`, nominal boleh ditulis polos (`1500000`), bertitik (`1.500.000`), atau dengan prefix (`Rp150000`).

---

## 1. Rekap & Saldo

### `/rekap` (atau `/hariini`)
Menampilkan rekap keuangan untuk hari ini (zona waktu `Asia/Jakarta` / WIB) atau tanggal tertentu.

**Sintaks:**
```text
/rekap
/hariini
/rekap <YYYY-MM-DD>
```

**Contoh:**
```text
/rekap
/hariini
/rekap 2026-11-22
```

**Contoh Output:**
```text
📊 Rekap Keuangan Hari Ini (Senin, 23 Nov 2026)

Anda telah menspend uang Rp 85.000 dan anda telah mendapat uang Rp 150.000 hari ini.
Selisih uang masuk keluar +65.000 rupiah (pendapatan lebih besar 📈)
-> Jumlah uang sekarang: Rp 1.565.000

Ingat hemat! 💡

📝 Transaksi: 3x (1 masuk, 2 keluar)
```

---

### `/bulan`
Menampilkan rekap total uang masuk, uang keluar, selisih, dan jumlah transaksi dalam satu bulan.

**Sintaks:**
```text
/bulan
/bulan <YYYY-MM>
```

**Contoh:**
```text
/bulan
/bulan 2026-11
```

---

### `/saldo`
Menampilkan jumlah uang (saldo) yang tersimpan di bot saat ini.

**Sintaks & Contoh:**
```text
/saldo
```

---

### `/setsaldo`
Mengatur atau menyinkronkan jumlah uang saat ini agar sama persis dengan saldo SeaBank Anda. Cukup dilakukan **sekali di awal**, atau kapan saja jika ingin menyinkronkan ulang saldo.

**Sintaks:**
```text
/setsaldo <nominal>
```

**Contoh:**
```text
/setsaldo 1500000
/setsaldo 1.500.000
/setsaldo 0
```

---

## 2. Riwayat & Pencatatan Manual (Opsional)

> Transaksi SeaBank yang masuk ke Gmail akan **tercatat otomatis setiap 60 detik**. Perintah di bawah berguna untuk melihat riwayat, mencatat transaksi tunai/non-email, atau menghapus data yang salah.

### `/riwayat`
Menampilkan daftar transaksi terakhir lengkap dengan **ID transaksi (`#1`, `#2`, dst.)**, nominal, keterangan, waktu, dan saldo setelah transaksi.

**Sintaks:**
```text
/riwayat
/riwayat <jumlah>
```
- Default: `10` transaksi terakhir.
- Maksimal: `30` transaksi.

**Contoh:**
```text
/riwayat
/riwayat 20
```

---

### `/masuk`
Mencatat pemasukan (uang masuk) secara manual. Saldo saat ini otomatis bertambah dan bot langsung mengirim notifikasi transaksi ringkas.

**Sintaks:**
```text
/masuk <nominal> [keterangan]
```

**Contoh:**
```text
/masuk 250000 Gaji freelance
/masuk 50.000 Transfer dari teman
/masuk 100000
```
*(Jika keterangan dikosongkan, otomatis diisi `Pemasukan Manual`.)*

---

### `/keluar`
Mencatat pengeluaran (uang keluar) secara manual. Saldo saat ini otomatis berkurang dan bot langsung mengirim notifikasi transaksi ringkas.

**Sintaks:**
```text
/keluar <nominal> [keterangan]
```

**Contoh:**
```text
/keluar 25000 Beli kopi
/keluar 45.000 Makan siang
/keluar 15000
```
*(Jika keterangan dikosongkan, otomatis diisi `Pengeluaran Manual`.)*

---

### `/hapus`
Menghapus transaksi tertentu berdasarkan **ID transaksi** (lihat ID lewat `/riwayat`).

- Jika yang dihapus adalah **uang masuk**, saldo otomatis **dikurangi** kembali.
- Jika yang dihapus adalah **uang keluar**, saldo otomatis **ditambahkan** kembali.

**Sintaks:**
```text
/hapus <id>
```

**Contoh:**
```text
/hapus 1
/hapus #4
```

---

## 3. Gmail, Status & Simulasi

### `/cekemail`
Memaksa bot segera memeriksa email notifikasi SeaBank baru di Gmail tanpa harus menunggu interval otomatis (60 detik).

**Sintaks & Contoh:**
```text
/cekemail
```

**Info yang ditampilkan:**
- Jumlah email SeaBank baru yang diperiksa
- Jumlah transaksi baru yang tercatat
- Jumlah email duplikat yang dilewati
- Jumlah email yang gagal di-parse

---

### `/status`
Menampilkan status kesehatan bot saat ini:
- Status koneksi Gmail IMAP & interval pengecekan
- Waktu sinkronisasi Gmail terakhir
- Jadwal cron rekap harian otomatis (default `0 0 * * *` / `00:00 WIB`, merekap 24 jam penuh hari yang baru selesai)
- Total transaksi tersimpan di database SQLite
- Jumlah uang sekarang
- Error Gmail terakhir (jika ada)

**Sintaks & Contoh:**
```text
/status
```

---

### `/simulasi`
Menguji apakah sebuah format email SeaBank dapat dikenali dengan benar oleh parser bot **tanpa menyimpan transaksi atau mengubah saldo**.

**Sintaks:**
```text
/simulasi <subject email> | <isi email>
```

**Contoh:**
```text
/simulasi Pembayaran QRIS Berhasil | Pembayaran QRIS sebesar Rp 35.000 ke Kopi Kenangan berhasil. Biaya Admin: Rp 0.
```

```text
/simulasi Transfer Masuk Berhasil | Kamu telah menerima dana sebesar Rp 250.000 dari BUDI SANTOSO. No. Referensi: SB123456.
```

---

### `/start` (atau `/help`)
Menampilkan pesan selamat datang, ringkasan daftar perintah, serta **Chat ID** Anda (jika `TELEGRAM_CHAT_ID` di `.env` belum dikonfigurasi).

**Sintaks & Contoh:**
```text
/start
/help
```

---

## 🔒 Keamanan Akses
Bot menggunakan **whitelist `TELEGRAM_CHAT_ID`** di file `.env`. Hanya pemilik dengan Chat ID terdaftar yang dapat menjalankan perintah di atas dan menerima notifikasi saldo/transaksi.
