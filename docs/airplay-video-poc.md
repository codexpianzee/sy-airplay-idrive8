# AirPlay Video (URL push) — Faz 1 kanıtı ve Faz 2 (araba) tasarımı

> Tarih: 28-29 Kasım 2026 · Test telefonu: iPhone18,2, AirPlay/980.77.1 (iOS 27 era)
> Faz 1 hedefi: **AirPlay Video** (paylaş tuşu → araba/alıcı kendi çalar, telefon kumandaya döner)
> — ekran yansıtma DEĞİL. Faz 1 PC'de uçtan uca KANITLANDI.

## Sonuç

UxPlay 1.74 (master, iç mDNS'li) Windows'ta MSYS2/UCRT64 + GStreamer 1.28 ile derlendi;
`-hls` + `-custom "AVC:480;VP9:0;AV1:0;HEVC:0"` ile YouTube uygulamasından AirPlay Video
**sorunsuz çaldı** (video PC'de, telefon kumanda). DRM'li uygulamalar (Netflix vb.) bu
protokolde ZATEN çalışmaz (Apple FairPlay) — beklenti dışı değildir.

## Çalışan zincir (logdan teyitli)

```
mDNS _airplay._tcp (features 0x527FFEF7: bit0 video + bit4 HLS + bit2 FairPlay-DRM-video,
                    bit7 mirroring, bit9 audio, bit12/14/22 auth, bit27 legacy pairing, bit30 RAOP)
  → POST /pair-verify (Ed25519, 3 adım) ✓ "signature is verified"
  → GET  /server-info (plist: features=639, model AppleTV3,2, vv=2)
  → POST /reverse (Upgrade: PTTH/1.0, purpose: event)  ← ters olay kanalı
  → POST /play  (binary plist: Content-Location = mlhls://localhost/master.m3u8,
                 clientBundleID com.google.ios.youtube, rate, volume...)
  → FCUP tur döngüsü (PTTH /event üzerinden "unhandledURLRequest",
                      telefonun cevabı POST /action "unhandledURLResponse"):
        master.m3u8 → sonra HER medya playlist'i TEK TEK
        (oynatıcı ancak HEPSİ gelince başlıyor: raop.c uri_num<num_uri döngüsü)
  → on_video_play(http://localhost:PORT/master.m3u8) → playbin3
  → hlsdemux2 local sunucudan varyantları çeker → d3d12decode/render
  → GET /playback-info (konum/süre) → telefon kumandayı gösterir
  → POST /rate?value=..., /scrub?..., /stop, PUT /setProperty?* (çoğu "unhandled",
     200 dönülüyor — sorun değil), POST /action playlistRemove...
```

## YouTube'a özgü kritik ayrıntılar

- `Content-Location` şeması **`mlhls://`** (Apple'ın yeni low-latency HLS türevi).
- Medya playlist'lerinde **`#YT-EXT-CONDENSED-URL`** (BASE-URI=googlevideo, PREFIX="s/")
  ve buna göre `s/<begin>/<len>/slices%3D...` segment yolları. Telefon bu yoğun URL'leri
  kendi çözüp FCUP yanıtıyla BYTES olarak geri gönderiyor; alıcı sadece aracı.
- **Master'daki varyant sayısı = FCUP tur sayısı.** 17 varyantlı bir videoda telefon
  ~10-11 turdan sonra yanıtlamayı bırakıyor → YouTube uygulaması ~15 sn'de "Bir sorun
  oluştu" deyip düşüyor. **Çözüm: `-custom` ile master'ı filtrele** (biz: AVC:480).
  6 tur → oynatıcı saniyeler içinde başlıyor. Bu, araba profiliyle birebir aynı:
  MGU zaten sadece H.264 çözer (RideTube: "H.264 only, up to 720p").

## PC tarafında çözülen tuzaklar (araba portu için de geçerli dersler)

1. **Arayüz seçimi:** alıcı Radmin VPN sanal kartını seçmişti (02:50:… MAC) → duyuru
   yanlış hat → telefon görmüyordu. Wi-Fi arayüzü (doğru MAC/IP) şart.
   *(Arabada: hangi arayüzün duyurulacağı servis config'inde sabitlenecek.)*
2. **Güvenlik duvarı:** Windows uxplay.exe için otomatik **Block** kuralları eklemişti
   (Public profil + iptal edilen popup). Allow kuralları Block'u YENEMEZ; Block'lar
   silinmeli. Ağ profili Private yapıldı.
3. **`-nc` şart:** video penceresi kapatılınca sunucu ölür (varsayılan). `-nc` ile
   sunucu ayakta kalıyor.
4. mDNS + HTTP + HLS portları için **Program bazlı TCP+UDP Allow** kuralı.
5. gst-libav MSYS2'de paket yoktu → kaynaktan derlendi (ffmpeg 9.1'e karşı).
   *(Arabada karşılığı: airplay-rx'in minimal FFmpeg'i; ses için ekstra çözücü gerekmez,
   ALAC/AAC çözücüsü zaten var.)*

## Faz 2 — MGU'ya taşıma (SY AirPlay'e AirPlay Video modu)

Mimari (h4m4d'nin airplay-rx derleme tarifi + RideTube oynatma hattı birleşimi):

| Parça | Kaynak | Arabada |
|---|---|---|
| Protokol çekirdeği | UxPlay `lib/` (pairing, httpd, raop, airplay_video, fairplay, FCUP) | aarch64 glibc 2.27'ye derleme (Zig/WSL — h4m4d tarifi, `mgu-hamadstools/airplay/receiver`) |
| mDNS | UxPlay iç mDNS yerine | ünitenin **mdnsd**'si + dns_sd shim (airplay-rx'in `libdns_sd.so.765→1096` yöntemi) |
| Oynatıcı | GStreamer playbin3 | **ytdec** (Intel Media SDK H.264) → MGVF kareler → mgu-render (RideTube hattı) + ses arabaya (RideTube "dinamik medya oynatıcı" yöntemi) — **en zor kısım ses** |
| Varyant filtresi | `-custom AVC:480…` | sabit gömülü (MGU H.264-only; telefon timeout'unu da önler) |
| Uygulama | uxplay.cpp | SY AirPlay uygulaması: video op'u zaten var (`mgu-video-sy-airplay` MGVF) + durum satırı + kumanda (rate/scrub uçlarını servise yollamak) |
| Güvenlik duvarı | nft (jap/airplay-rx deseni) | aynı: TCP 7100/7101, UDP 6100/6101/7111, 5353 + HTTP portu |

Riskler / açık sorular (PC'de ölçüldü, arabada test edilecek):
- FCUP tur gecikmesi Wi-Fi'da ~1 sn/tur — arabada benzer beklenir; varyant filtresi bunu
  tolere edilebilir kılıyor (6 tur). Gerekirse filtre "AVC:360"e kadar daraltılabilir.
- Segment aktarımı telefon üzerinden olduğundan ilk saniyelerde tamponlama doğal.
- Ses: YouTube video modunda ses ALAC kanalından da akıyor (logda teyit) — arabada
  RideTube'nin car-media-player yolu kullanılmalı; koptuğu durumda "ses yok" bilinen sınır.
- iOS 27 davranışları UxPlay 1.73.7'de düzeltilmiş (TEARDOWN); biz master'dayız.

## PC demo kurulumu (tekrar kurmak gerekirse)

- MSYS2 → `pacman -S mingw-w64-ucrt-x86_64-{gcc,cmake,pkgconf,openssl,libplist,gstreamer,gst-plugins-{base,good,bad},ffmpeg,meson}`
- gst-libav 1.28.9 kaynaktan (ffmpeg 9.1'e, `--prefix=/ucrt64`)
- `git clone FDH2/UxPlay && cmake + build`
- Çalıştırma: `Start-SY-AirPlay-PC.cmd` (C:\Users\lordi) —
  `uxplay -hls -n SY-AirPlay-PC -nc -custom 'AVC:480;VP9:0;AV1:0;HEVC:0'`
- Radmin VPN test sırasında devre dışı; ağ profili Private; Block kuralları yok.
