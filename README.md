## Note
 This is a fork of [media-control](https://github.com/sakithb/media-controls) by @sakithb, with the purpose of adding a feature to display the current player's lyric information.

## What does this extension do?

Show controls and information of the currently playing media in the panel.

## Features

- Customize the extension the way you want it
- Basic media controls (play/pause/next/previous/loop/shuffle/seek)
- Mouse actions lets you run different actions via left/middle/right/scroll.
- Popup with album art and a slider to control the playback
- Scrolling animations
- Blacklist players
- Register a DBus service, receive lyric from clients, and show it


# How to use the lyric service ?
-  ## DBus information
    - busName = "org.gnome.Shell.TrayLyric"
    - objectPath = "/org/gnome/Shell/TrayLyric"
    - interfaceName = "org.gnome.Shell.TrayLyric"

    - `UpdateLyric: (lrcObj: string) => void`: 
        - Parameter: lrcObj, a JSON string in the following format:
          ```json
          {
            "content": "lyric",
            // Current lyric.If set to "", it will display the media title.

            "time": "4.5", 
            // Numeric type, in seconds, used to control the speed and duration
            // of the lyric scrolling.
            
            "sender": "VutronMusic" 
            // Part of your mpris player's name. For exmaple,if the name of your
            // mpris player is ‘org.mpris.MediaPlayer2.VutronMusic’， the sender 
            // should set to 'VutronMusic', or 'MediaPlayer2' or any part of the
            // name, but an inaccurate name may cause the player and the lyrics 
            // to not match correctly.
          }
          ```
---
## How to install

#### Install from extensions.gnome.org (Recommended)

[<img src="assets/images/ego.png" height="100">](https://extensions.gnome.org/extension/4470/media-controls/)

#### Manual installation

Install from source

- Download archive file from the releases tab
- Open a terminal in the directory containing the downloaded file
- Install and enable the extension by executing `gnome-extensions install extension.zip --force` in the terminal

---

## Reporting issues

- Make sure your issue isn't a duplicate
- Include the following information when creating the issue,
    - Extension version
    - Gnome version
    - Your distribution
    - A screenshot if it is possible

---

## Get involved

Any type of contribution is appreciated! If you have any suggestions for new features feel free to open a new issue.

If you are interested in translating, download the [po file](https://github.com/sakithb/media-controls/blob/main/assets/locale/mediacontrols%40cliffniff.github.com.pot) and translate it. Then open a pull request with the translated file. You can use [Gtranslator](https://flathub.org/apps/org.gnome.Gtranslator) or [Poedit](https://flathub.org/apps/net.poedit.Poedit) to translate.

If you are interested in contributing code. There are no specific guidelines for contributing. Just make sure you follow the coding style of the project. To update the translation files run `./mediacontrols.sh translations` in the extensions directory after your changes are done. This will update the files in the locale folder.

<a href="https://github.com/sakithb/media-controls/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=sakithb/media-controls" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

## Screenshots

#### Popup menu

[<img src="assets/images/popup.png" width="400">]()

#### General settings

[<img src="assets/images/prefs_general.png" width="400">]()

#### Panel settings

[<img src="assets/images/prefs_panel.png" width="400">]()

#### Position settings

[<img src="assets/images/prefs_positions.png" width="400">]()

#### Shortcut settings

[<img src="assets/images/prefs_shortcuts.png" width="400">]()

#### Other settings

[<img src="assets/images/prefs_other.png" width="400">]()
