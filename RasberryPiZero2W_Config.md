Плата

Плата: Rasberry Pi Zero 2W

host: PartyBox

user: gost

password: gost

ssid: server Pentagona

wi-fi-pass: EDA8HD6D6J



Компоненты

Усилитель аудио - MAX98357A

Бустер 5.15V - MT3608

Зарядка -

Аккумулятор - 18650 2шт.



Команды

&#x09;ping PartyBox.local

&#x09;ssh gost@PartyBox.local

&#x09;sudo reboot

&#x09;sudo poweroff

Сброс ssh при ошибке:

&#x09;ssh-keygen -R PartyBox.local

Заливка проекта:

&#x09;scp -r "C:\\Users\\Dmitriy\\Desktop\\Проекты\\PartyBox\\ProjectPartyBox\\\*" gost@PartyBox.local:\~/PartyBox/

Запуск сервера (ПЕРЕНЕСИ В АВТОЗАПУСК)

&#x09;node server.js

Выключить (если нет кнопки) Сохранить Ctrl + O ➔ Enter ➔ Ctrl + X.

&#x09;sudo poweroff



Что подключено\\настроено на плате:

~~1. Автоматический ремонт диска при старте~~

&#x09;~~sudo nano /boot/firmware/cmdline.txt~~

~~В самый конец единственной строки (строго через пробел, не нажимая Enter) добавить:~~

&#x09;~~fsck.repair=yes~~



2\. Автоматическая регенерация поврежденных ключей SSH

Выполните команду активации встроенного генератора ключей:

&#x09;sudo systemctl enable ssh-keygen.target 2>/dev/null || sudo ssh-keygen -A

Убедитесь, что сам демон SSH включен в автозагрузку:

&#x09;sudo systemctl enable ssh



3\. Кнопка питания - Pin 5, Pin 6

Активируйте обработку кнопки в системе:

&#x09;nano /boot/firmware/config.txtн

В самый конец файла добавить строку:

&#x09;dtoverlay=gpio-shutdown,gpio\_pin=3



4\. Увеличение подкачки до 1Гб

&#x09;sudo fallocate -l 1G /swapfile

&#x09;sudo chmod 600 /swapfile

&#x09;sudo mkswap /swapfile

&#x09;sudo swapon /swapfile

&#x09;echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

Критерий успеха: команда free -m показывает в строке Swap около 1024 МБ.



Установки для игры:

1\. Node.js

&#x09;sudo apt update \&\& sudo apt install -y nodejs npm

&#x09;mkdir -p \~/PartyBox

Критерий успеха: команды node -v и npm -v выводят установленные версии.

