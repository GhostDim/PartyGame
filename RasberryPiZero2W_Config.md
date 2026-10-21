Плата

```
Плата: Rasberry Pi Zero 2W
host: PartyBox
user: gost
password: gost
ssid: server Pentagona
wi-fi-pass: EDA8HD6D6J
```

Компоненты

```
Усилитель аудио (с динамиком) - MAX98357A
Бустер 5.15V - MT3608
Зарядка -
Аккумулятор - 18650 2шт.
Адресная RGB - WS2812B, 48 светодиодов, 4 полосы по 12

```


Пины
```
5 и 6 — кнопка включения и выключения
19 — данные адресной ленты

```

Команды

```
ssh gost@PartyBox.local
sudo reboot
sudo poweroff
```

Сброс ssh при ошибке:

```
ssh-keygen -R PartyBox.local
```

Заливка проекта:

```
scp -r "C:\\Users\\Dmitriy\\Desktop\\Проекты\\PartyBox\\ProjectPartyBox\\\*" gost@PartyBox.local:\~/PartyBox/
```

Запуск сервера (ПЕРЕНЕСИ В АВТОЗАПУСК)

```
node server.js
```

Выключить

```
sudo poweroff
```

---

Что подключенонастроено на плате:

1 Автоматическая регенерация поврежденных ключей SSH

Выполните команду активации встроенного генератора ключей:

```
sudo systemctl enable ssh-keygen.target 2>/dev/null || sudo ssh-keygen -A
```

Убедитесь, что сам демон SSH включен в автозагрузку:

```
sudo systemctl enable ssh
```

2 Кнопка питания - Pin 5, Pin 6

Активируйте обработку кнопки в системе:

```
nano /boot/firmware/config.txt
```

В самый конец файла добавить строку:

```
dtoverlay=gpio-shutdown,gpio_pin=3
```

3 Увеличение подкачки до 1Гб

```
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Критерий успеха: команда free -m показывает в строке Swap около 1024 МБ.

---

Установки для игры:

1 Node.js

```
sudo apt update && sudo apt install -y nodejs npm

mkdir -p ~/PartyBox
```

Критерий успеха: команды node -v и npm -v выводят установленные версии.

2 Для ленты доработать конфиг!

```
sudo nano /boot/firmware/config.txt
Добавьте в самый конец файла эти строки:
core_freq=250
core_freq_min=250
```

`force_turbo=1` не добавлять: при 5,10 В плата с этой строкой не включается. Если уже добавлена и плата молчит, удалить её из `config.txt` на карте через компьютер.

3 Усилитель MAX98357A

Если в `config.txt` есть `dtparam=audio=on`, закомментировать: она занимает GPIO 18.

```
sudo nano /boot/firmware/config.txt
```

В конец файла:

```
dtoverlay=max98357a,sdmode-pin=4
```

```
sudo apt install -y alsa-utils
sudo usermod -aG audio gost
sudo reboot
```

После перезагрузки, из каталога проекта:

```
aplay -l
aplay -D plughw:CARD=MAX98357A,DEV=0 sounds/startup.wav
```

Критерий успеха: в `aplay -l` есть карта MAX98357A и из динамика играет мелодия включения. Схема — в `docs/PINS.md`.

