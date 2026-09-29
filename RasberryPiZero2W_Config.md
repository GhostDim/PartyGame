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
Адресная RGB - WS2812B 60LED/m 5V IP20
```

Команды

```
пщые
ъ
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
nano /boot/firmware/config.txtн
```

В самый конец файла добавить строку:

```
dtoverlay=gpio-shutdown,gpio\_pin=3
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
sudo apt update \&\& sudo apt install -y nodejs npm

mkdir -p \~/PartyBox
```

Критерий успеха: команды node -v и npm -v выводят установленные версии.