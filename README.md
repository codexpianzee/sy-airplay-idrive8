# AirPlay for iDrive 8

**iPhone ekranını BMW iDrive 8 ekranına AirPlay ekran yansıtma ile getirir.** Görüntü sadece araç park halindeyken
çıkar. Ses Bluetooth ile arabaya gider. Uygulama, [MGU Store](https://github.com/robertnisipeanu/mgu-store) üzerinden
kurulur.

Bu proje h4m4d'nin iDrive 7 için yaptığı **AirPlay** uygulamasının ([mgu-hamadstools](https://github.com/noth4m4d/mgu-hamadstools))
iDrive 8'e taşınmış hâlidir. AirPlay alıcısı (`airplay-rx`, UxPlay'in AirPlay kütüphanesi) onun yayımladığı haliyle,
değiştirilmeden kullanılır. Ekran ve uygulama kiti [MeTube](https://github.com/trnaslan/metube-idrive8) ile aynıdır.

> **Resmi değildir, deneyseldir.** Apple veya BMW ile bir bağlantısı yoktur. Kullanım riski sana aittir. Sürüş
> sırasında görüntü gösterilmez (ayar: *Parked only*, varsayılan açık).

| | |
|---|---|
| ![Hazır](docs/media/ready.png) | ![Yansıtma](docs/media/mirroring.png) |
| Bağlanma adımları ve durum | Yansıtma: dokununca üst çubuk (Geri, durum) |

Ekran görüntüleri bilgisayarda, arabanın 2880 x 960 ekranında test ortamıyla çizildi. Mavi alan, iPhone görüntüsünün
geleceği yer.

## Durum

**Henüz arabada denenmedi.** Uygulama ve servis, iDrive 8 test ortamında ve MGU Store'un kendi bağlayıcısıyla test
edildi. `airplay-rx` iDrive 7'de çalışıyor. iDrive 8'de belirsiz olanlar:

- `airplay-rx`'in bağlandığı kütüphaneler: `libcrypto.so.1.1`, `libdns_sd.so.765`, `libva.so.1`, `libva-drm.so.1`.
  Kurulumdaki kontrol (`check.sh`) eksik olanı adıyla söyler.
- mdnsd (`/run/mdnsd/mdnsd_uds`): iPhone'un arabayı listede görmesi için gerekli.
- Arabanın Wi-Fi arayüzünün adı ve güvenlik duvarı (aşağıda, *Ayarlar*).

## Kurulum

1. Ana ünitede root SSH ve MGU Store kurulu olmalı (MGU Store README'si).
2. Store'da: **Settings → Add source** → `trnaslan/airplay-idrive8` → **Releases**.
3. **AirPlay** uygulamasını kur. Servisi (`jap-airplay-d`, "AirPlay service (iDrive 8)") de onunla gelir.
4. **Ana üniteyi yeniden başlat.** iDrive 8'de bir uygulama bir sonraki açılışta kurulur.

## Kullanım

1. iDrive'da **AirPlay** uygulamasını aç. Alıcı sadece uygulama açıkken çalışır ve kendini duyurur.
2. iPhone'da CarPlay bağlantısını kes.
3. iPhone'u arabanın Wi-Fi ağına bağla.
4. iPhone: **Denetim Merkezi → Ekran Yansıtma →** arabanın adı (Bluetooth adı, ör. `BMW 12345`; ekranda yazar).
5. Ses: iPhone'un ses çıkışını **BMW (Bluetooth)** olarak bırak.

Yansıtma başlayınca görüntü otomatik açılır. Görüntüye dokunursan üstte **Geri** ve durum çıkar.

Yansıtma sırasında arabanın interneti olmaz (iPhone hotspot yerine arabanın Wi-Fi'ına bağlıdır). Yansıtma için internet
gerekmez.

## Bir şey çalışmazsa

Uygulamanın ekranındaki durum satırı ne olduğunu söyler. Ayrıntılar arabada:

```sh
cat /dev/shm/mgu-airplay8-d.json                 # servisin durumu: state, err, ifaces, firewall
cat /dev/shm/mgu-airplay-status.json             # airplay-rx'in durumu: mirroring, client, fps
tail -50 /var/opt/jap-airplay-d/log/airplay-rx.log
tail -50 /var/opt/jap-airplay-d/log/airplayd.log
```

## Ayarlar (servis)

`/var/opt/jap-airplay-d/state/config.json` dosyasında, hepsi isteğe bağlı. Değişiklik bir sonraki açılışta geçerli olur
(uygulamayı kapatıp aç):

```json
{
  "name": "BMW 12345",
  "ifaces": ["wlan0"],
  "firewall": true,
  "hw": false,
  "args": ["-d"]
}
```

| Anahtar | |
|---|---|
| `name` | iPhone'un listede gördüğü ad. Varsayılan: arabanın Bluetooth adı (bulunamazsa "BMW AirPlay"). |
| `ifaces` | Güvenlik duvarı kurallarının açılacağı Wi-Fi arayüzleri. Varsayılan: `/sys/class/net` içindeki `wlan*`, `br*`, `ap*` vb. ve `wlan_bridge`. |
| `firewall` | `false`: hiç kural ekleme (portlar zaten açıksa). |
| `hw` | `true`: GPU ile çözme (`airplay-rx` `-s` olmadan). iDrive 7'de çalışmıyordu, varsayılan kapalı. |
| `audio` | `true`: sesi de duyur. Sesin gidecek yeri yok, varsayılan kapalı. |
| `args` | `airplay-rx`'e ek argümanlar (`-d`: ayrıntılı log). |

Güvenlik duvarı kuralları `jap-airplay8` yorumuyla eklenir: TCP 7100/7101, UDP 6100/6101/7111 ve 5353. Sadece uygulama
açıkken durur; uygulama kapanınca ve servis durunca silinir.

## Nasıl çalışır

| | |
|---|---|
| `apps/jap_airplay/` | iDrive 8 uygulaması (`jap_airplay8`): adımlar, durum, tam ekran görüntü (renderer'ın video op'u), park kontrolü. Ekran açıkken her saniye `/dev/shm/mgu-airplay8-want` dosyasına dokunur. |
| `native/jap-airplay-d/` | Servis (`airplayd.js`, arabanın Node 8'i, root): istek dosyası tazeyken `airplay-rx`'i başlatır ve güvenlik duvarını açar, bayatlayınca ikisini de kapatır. `airplay-rx` görüntüyü `/dev/shm/mgu-video-airplay` dosyasına (mgu-render MGVF) yazar. |
| `kit/` | MeTube / RideTube uygulama kiti (MIT). |
| `tools/release_id8.sh` | Sürüm: `airplay-rx` 1.0.0'ı h4m4d'nin sürümünden indirir, sha256 ile doğrular, uygulamayı ve servisi paketler. |

`airplay-rx`'in kendi `-a` modu kullanılmaz, çünkü uygulamayı iDrive 7 yolunda arar ve güvenlik duvarı kuralında
iDrive 7'nin `wlan_bridge` arayüzünü kullanır. Bu yüzden ikisini de servis yapar ve ikili dosya yeniden derlenmez.

## Derleme ve test

```sh
python3 kit/tools/build.py --hmi ID8 jap_airplay
node kit/tools/test_airplay8.js                     # SHOTS=<klasör>: her adımın ekran görüntüsü
node native/jap-airplay-d/test/test_airplayd.js
node kit/tools/test_node8.js
MGU_STORE=<mgu-store klonu> node kit/tools/test_mgu8.js
MGU_STORE=<mgu-store klonu> sh tools/release_id8.sh  # dist/release/
```

`main` dalına push olunca GitHub Actions (`.github/workflows/release.yml`) sürümü oluşturup `catalog` etiketli
release'e yükler. Store bu release'i okur.

## Lisans

GPL-3.0-or-later ([LICENSE](LICENSE)). Kit MIT ([kit/LICENSE](kit/LICENSE)). Üçüncü taraf parçalar ve kaynakları:
[NOTICE.md](NOTICE.md). AirPlay alıcısı için h4m4d'ye ve UxPlay'e teşekkürler.
