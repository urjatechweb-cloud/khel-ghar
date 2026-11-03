# खेल घर · Khel Ghar

Nepali games over Wi-Fi or a phone hotspot: Callbreak, Teen Patti, Kitti, Marriage, Baag Chal, Ludo. Empty seats can be filled with bots.

## Play online (share with friends)
Open **https://urjatechweb-cloud.github.io/khel-ghar/**, enter your name, pick a game and tap **Share invite link**. Friends open the link and join from anywhere.
The room runs on the creator's phone (peer-to-peer via [PeerJS](https://peerjs.com)), so the creator keeps the app open while playing. If anyone refreshes, they rejoin automatically.

## Play on Wi-Fi / hotspot without internet
One device is the host. It needs Node.js 18 or newer, and nothing else to install.

```bash
node server.js
```

The host prints an address like `http://192.168.1.5:3000`. Everyone on the same Wi-Fi or hotspot opens that address in their phone browser. One person taps a game and shares the 4-digit room code. Everyone else joins with that code.

- **Hosting from an Android phone:** install Termux, run `pkg install nodejs`, copy this folder over, and run `node server.js`. Turn on the phone's hotspot and let friends connect to it.
- **Install like an app:** open the address in your browser, then choose "Add to Home screen".
- **Refreshing or losing Wi-Fi:** you rejoin your seat automatically. If you leave mid-game, a bot plays your seat.

## Check
```bash
node test.js
```
This runs the rule checks and about 4,000 bot-only games, including 150 Marriage rounds.
