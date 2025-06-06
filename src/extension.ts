import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Mpris from "resource:///org/gnome/shell/ui/mpris.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import PanelButton from "./helpers/shell/PanelButton.js";
import PlayerProxy from "./helpers/shell/PlayerProxy.js";
import { debugLog, enumValueByIndex, errorLog, handleError } from "./utils/common.js";
import { getAppByIdAndEntry, createDbusProxy } from "./utils/shell_only.js";
import { StdInterface } from "./types/dbus.js";
import { KeysOf } from "./types/misc.js";
import {
    PlaybackStatus,
    WidgetFlags,
    LabelTypes,
    PanelElements,
    MPRIS_PLAYER_IFACE_NAME,
    DBUS_PROPERTIES_IFACE_NAME,
    MPRIS_IFACE_NAME,
    DBUS_OBJECT_PATH,
    DBUS_IFACE_NAME,
    ExtensionPositions,
    MouseActions,
    LYRIC_IFACE_NAME,
    LYRIC_OBJECT_PATH
} from "./types/enums/common.js";

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

type ElementsOrder = KeysOf<typeof PanelElements>[];
type LabelsOrder = (KeysOf<typeof LabelTypes> | (string & NonNullable<unknown>))[];

export default class MediaControls extends Extension {
    public labelWidth: number;
    public isFixedLabelWidth: boolean;
    public scrollLabels: boolean;
    public hideMediaNotification: boolean;
    public showLabel: boolean;
    public showPlayerIcon: boolean;
    public showControlIcons: boolean;
    public showControlIconsPlay: boolean;
    public showControlIconsNext: boolean;
    public showControlIconsPrevious: boolean;
    public showControlIconsSeekForward: boolean;
    public showControlIconsSeekBackward: boolean;
    public coloredPlayerIcon: boolean;
    public extensionPosition: ExtensionPositions;
    public extensionIndex: number;
    public elementsOrder: ElementsOrder;
    public labelsOrder: LabelsOrder;
    public shortcutShowMenu: string;
    public mouseActionLeft: MouseActions;
    public mouseActionMiddle: MouseActions;
    public mouseActionRight: MouseActions;
    public mouseActionDouble: MouseActions;
    public mouseActionScrollUp: MouseActions;
    public mouseActionScrollDown: MouseActions;
    public cacheArt: boolean;
    public blacklistedPlayers: string[];

    private settings: Gio.Settings;
    private panelBtn: InstanceType<typeof PanelButton>;

    private watchProxy: StdInterface;
    private playerProxies: Map<string, [PlayerProxy, unknown]>;
    private chosenBusName: string;

    private watchIfaceInfo: Gio.DBusInterfaceInfo;
    private mprisIfaceInfo: Gio.DBusInterfaceInfo;
    private mprisPlayerIfaceInfo: Gio.DBusInterfaceInfo;
    private propertiesIfaceInfo: Gio.DBusInterfaceInfo;
    private lyricIfaceInfo: Gio.DBusInterfaceInfo;
    private ownerId: number;

    private mediaSectionAddFunc: (busName: string) => void;

    public enable() {
        this.playerProxies = new Map();

        this.initSettings();
        this.initProxies().catch(handleError);
        this.updateMediaNotificationVisiblity();

        Main.wm.addKeybinding(
            "mediacontrols-show-popup-menu",
            this.settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => {
                this.panelBtn?.menu.toggle();
            },
        );

        debugLog("Enabled");
    }

    public disable() {
        this.playerProxies = null;
        this.destroySettings();

        this.watchIfaceInfo = null;
        this.mprisIfaceInfo = null;
        this.mprisPlayerIfaceInfo = null;
        this.propertiesIfaceInfo = null;
        this.watchProxy = null;
        this.lyricIfaceInfo = null;

        Gio.bus_unown_name(this.ownerId);
        this.removePanelButton();
        this.updateMediaNotificationVisiblity(true);

        Main.wm.removeKeybinding("mediacontrols-show-popup-menu");

        debugLog("Disabled");
    }

    public getPlayers() {
        const players: [PlayerProxy, unknown][] = [];

        for (const player of this.playerProxies.values()) {
            if (player[0].isInvalid) {
                continue;
            }

            players.push(player);
        }

        return players;
    }

    private initSettings() {
        this.settings = this.getSettings();

        this.labelWidth = this.settings.get_uint("label-width");
        this.isFixedLabelWidth = this.settings.get_boolean("fixed-label-width");
        this.scrollLabels = this.settings.get_boolean("scroll-labels");
        this.hideMediaNotification = this.settings.get_boolean("hide-media-notification");
        this.showLabel = this.settings.get_boolean("show-label");
        this.showPlayerIcon = this.settings.get_boolean("show-player-icon");
        this.showControlIcons = this.settings.get_boolean("show-control-icons");
        this.showControlIconsPlay = this.settings.get_boolean("show-control-icons-play");
        this.showControlIconsNext = this.settings.get_boolean("show-control-icons-next");
        this.showControlIconsPrevious = this.settings.get_boolean("show-control-icons-previous");
        this.showControlIconsSeekForward = this.settings.get_boolean("show-control-icons-seek-forward");
        this.showControlIconsSeekBackward = this.settings.get_boolean("show-control-icons-seek-backward");
        this.coloredPlayerIcon = this.settings.get_boolean("colored-player-icon");
        this.extensionPosition = enumValueByIndex(ExtensionPositions, this.settings.get_enum("extension-position"));
        this.extensionIndex = this.settings.get_uint("extension-index");
        this.elementsOrder = this.settings.get_strv("elements-order") as ElementsOrder;
        this.labelsOrder = this.settings.get_strv("labels-order") as LabelsOrder;
        this.mouseActionLeft = this.settings.get_enum("mouse-action-left") as MouseActions;
        this.mouseActionMiddle = this.settings.get_enum("mouse-action-middle") as MouseActions;
        this.mouseActionRight = this.settings.get_enum("mouse-action-right") as MouseActions;
        this.mouseActionDouble = this.settings.get_enum("mouse-action-double") as MouseActions;
        this.mouseActionScrollUp = this.settings.get_enum("mouse-action-scroll-up") as MouseActions;
        this.mouseActionScrollDown = this.settings.get_enum("mouse-action-scroll-down") as MouseActions;
        this.cacheArt = this.settings.get_boolean("cache-art");
        this.blacklistedPlayers = this.settings.get_strv("blacklisted-players");

        this.settings.connect("changed::label-width", () => {
            this.labelWidth = this.settings.get_uint("label-width");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_LABEL | WidgetFlags.MENU_LABELS | WidgetFlags.MENU_IMAGE);
        });

        this.settings.connect("changed::fixed-label-width", () => {
            this.isFixedLabelWidth = this.settings.get_boolean("fixed-label-width");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_LABEL | WidgetFlags.MENU_LABELS | WidgetFlags.MENU_IMAGE);
        });

        this.settings.connect("changed::scroll-labels", () => {
            this.scrollLabels = this.settings.get_boolean("scroll-labels");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_LABEL | WidgetFlags.MENU_LABELS);
        });

        this.settings.connect("changed::hide-media-notification", () => {
            this.hideMediaNotification = this.settings.get_boolean("hide-media-notification");
            this.updateMediaNotificationVisiblity();
        });

        this.settings.connect("changed::show-label", () => {
            this.showLabel = this.settings.get_boolean("show-label");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_LABEL);
        });

        this.settings.connect("changed::show-player-icon", () => {
            this.showPlayerIcon = this.settings.get_boolean("show-player-icon");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_ICON);
        });

        this.settings.connect("changed::show-control-icons", () => {
            this.showControlIcons = this.settings.get_boolean("show-control-icons");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_CONTROLS);
        });

        this.settings.connect("changed::show-control-icons-play", () => {
            this.showControlIconsPlay = this.settings.get_boolean("show-control-icons-play");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_CONTROLS_PLAYPAUSE);
        });

        this.settings.connect("changed::show-control-icons-next", () => {
            this.showControlIconsNext = this.settings.get_boolean("show-control-icons-next");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_CONTROLS_NEXT);
        });

        this.settings.connect("changed::show-control-icons-previous", () => {
            this.showControlIconsPrevious = this.settings.get_boolean("show-control-icons-previous");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_CONTROLS_PREVIOUS);
        });

        this.settings.connect("changed::show-control-icons-seek-forward", () => {
            this.showControlIconsSeekForward = this.settings.get_boolean("show-control-icons-seek-forward");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_CONTROLS_SEEK_FORWARD);
        });

        this.settings.connect("changed::show-control-icons-seek-backward", () => {
            this.showControlIconsSeekBackward = this.settings.get_boolean("show-control-icons-seek-backward");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_CONTROLS_SEEK_BACKWARD);
        });

        this.settings.connect("changed::colored-player-icon", () => {
            this.coloredPlayerIcon = this.settings.get_boolean("colored-player-icon");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_ICON);
        });

        this.settings.connect("changed::extension-position", () => {
            const enumIndex = this.settings.get_enum("extension-position");
            this.extensionPosition = enumValueByIndex(ExtensionPositions, enumIndex);
            this.removePanelButton();
            this.setActivePlayer();
        });

        this.settings.connect("changed::extension-index", () => {
            this.extensionIndex = this.settings.get_uint("extension-index");
            this.removePanelButton();
            this.setActivePlayer();
        });

        this.settings.connect("changed::elements-order", () => {
            this.elementsOrder = this.settings.get_strv("elements-order") as ElementsOrder;
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_NO_REPLACE);
        });

        this.settings.connect("changed::labels-order", () => {
            this.labelsOrder = this.settings.get_strv("labels-order") as LabelsOrder;
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_LABEL);
        });

        this.settings.connect("changed::mouse-action-left", () => {
            this.mouseActionLeft = this.settings.get_enum("mouse-action-left") as MouseActions;
        });

        this.settings.connect("changed::mouse-action-middle", () => {
            this.mouseActionMiddle = this.settings.get_enum("mouse-action-middle") as MouseActions;
        });

        this.settings.connect("changed::mouse-action-right", () => {
            this.mouseActionRight = this.settings.get_enum("mouse-action-right") as MouseActions;
        });

        this.settings.connect("changed::mouse-action-double", () => {
            this.mouseActionDouble = this.settings.get_enum("mouse-action-double") as MouseActions;
        });

        this.settings.connect("changed::mouse-action-scroll-up", () => {
            this.mouseActionScrollUp = this.settings.get_enum("mouse-action-scroll-up") as MouseActions;
        });

        this.settings.connect("changed::mouse-action-scroll-down", () => {
            this.mouseActionScrollDown = this.settings.get_enum("mouse-action-scroll-down") as MouseActions;
        });

        this.settings.connect("changed::cache-art", () => {
            this.cacheArt = this.settings.get_boolean("cache-art");
        });

        this.settings.connect("changed::blacklisted-players", () => {
            this.blacklistedPlayers = this.settings.get_strv("blacklisted-players");

            for (const playerProxy of this.playerProxies.values()) {
                if (this.isPlayerBlacklisted(playerProxy[0].identity, playerProxy[0].desktopEntry)) {
                    this.removePlayer(playerProxy[0].busName);
                }
            }

            this.addRunningPlayers();
        });
    }

    private async initProxies() {
        const mprisXmlFile = Gio.File.new_for_path(`${this.path}/dbus/mprisNode.xml`);
        const watchXmlFile = Gio.File.new_for_path(`${this.path}/dbus/watchNode.xml`);
        const lyricXmlFile = Gio.File.new_for_path(`${this.path}/dbus/lyricNode.xml`);

        const mprisResult = mprisXmlFile.load_contents_async(null);
        const watchResult = watchXmlFile.load_contents_async(null);
        const lyricResult = lyricXmlFile.load_contents_async(null);

        const readResults = await Promise.all([mprisResult, watchResult, lyricResult]).catch(handleError);

        if (readResults == null) {
            errorLog("Failed to read xml files");
            return;
        }

        const mprisBytes = readResults[0];
        const watchBytes = readResults[1];
        const lyricBytes = readResults[2];

        const textDecoder = new TextDecoder();

        const watchNodeXml = textDecoder.decode(watchBytes[0]);
        const mprisNodeXml = textDecoder.decode(mprisBytes[0]);
        const lyricNodeXml = textDecoder.decode(lyricBytes[0]);

        const watchNodeInfo = Gio.DBusNodeInfo.new_for_xml(watchNodeXml);
        const watchInterface = watchNodeInfo.lookup_interface(DBUS_IFACE_NAME);
        this.watchIfaceInfo = watchInterface;

        const lyricNodeInfo = Gio.DBusNodeInfo.new_for_xml(lyricNodeXml);
        const lyricInterface = lyricNodeInfo.lookup_interface(LYRIC_IFACE_NAME);
        // @ts-expect-error nothing
        const lyricIfaceInfoString = new GLib.String("");
        lyricInterface.generate_xml(4, lyricIfaceInfoString);
        this.lyricIfaceInfo = lyricInterface;

        const mprisNodeInfo = Gio.DBusNodeInfo.new_for_xml(mprisNodeXml);
        const mprisInterface = mprisNodeInfo.lookup_interface(MPRIS_IFACE_NAME);
        const mprisPlayerInterface = mprisNodeInfo.lookup_interface(MPRIS_PLAYER_IFACE_NAME);
        const propertiesInterface = mprisNodeInfo.lookup_interface(DBUS_PROPERTIES_IFACE_NAME);

        // @ts-expect-error nothing
        const mprisInterfaceString = new GLib.String("");
        mprisInterface.generate_xml(4, mprisInterfaceString);

        // @ts-expect-error nothing
        const mprisPlayerInterfaceString = new GLib.String("");
        mprisPlayerInterface.generate_xml(4, mprisPlayerInterfaceString);

        // @ts-expect-error nothing
        const propertiesInterfaceString = new GLib.String("");
        propertiesInterface.generate_xml(4, propertiesInterfaceString);

        this.mprisIfaceInfo = mprisInterface;
        this.mprisPlayerIfaceInfo = mprisPlayerInterface;
        this.propertiesIfaceInfo = propertiesInterface;

        const initWatchSuccess = await this.initWatchProxy().catch(handleError);

        if (initWatchSuccess === false) {
            errorLog("Failed to init watch proxy");
            return;
        }

        await this.addRunningPlayers();
        await this.createLyricProxy().catch(handleError)
    }

    private async initWatchProxy() {
        this.watchProxy = await createDbusProxy<StdInterface>(
            this.watchIfaceInfo,
            DBUS_IFACE_NAME,
            DBUS_OBJECT_PATH,
        ).catch(handleError);

        if (this.watchProxy == null) {
            return false;
        }

        this.watchProxy.connectSignal("NameOwnerChanged", (proxy, senderName, [busName, oldOwner, newOwner]) => {
            if (busName.startsWith(MPRIS_IFACE_NAME) === false) {
                return;
            }

            if (newOwner === "") {
                this.removePlayer(busName);
            } else if (oldOwner === "") {
                this.addPlayer(busName);
            }
        });

        return true;
    }

    private async createLyricProxy() {
        this.ownerId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            LYRIC_IFACE_NAME,
            Gio.BusNameOwnerFlags.NONE,
            (connect: Gio.DBusConnection) => {
                connect.register_object(
                    LYRIC_OBJECT_PATH,
                    this.lyricIfaceInfo,
                    this.onNameAcquired.bind(this),
                    null,
                    null,
                );
            },
            null,
            null,
        );
    }

    private onNameAcquired(connection, sender, object_path, interface_name, method_name, parameters, invocation) {
        if (method_name === "UpdateLyric") {
            const current_lyric = parameters.unpack()[0];
            const lrc = JSON.parse(current_lyric.get_string()[0]);

            if (lrc.content === "") {
                this.panelBtn?.updateLyric(undefined);
                invocation.return_value(null);
            }

            if (this.chosenBusName?.includes(lrc.sender)) {
                this.panelBtn?.updateLyric(lrc);
                invocation.return_value(null);
            }

            invocation.return_value(null);
        }
    }

    private async addRunningPlayers() {
        const namesResult = await this.watchProxy.ListNamesAsync().catch(handleError);

        if (namesResult == null) {
            errorLog("Failed to get bus names");
            return;
        }

        const busNames = namesResult[0];
        const promises = [];

        for (const busName of busNames) {
            if (busName.startsWith(MPRIS_IFACE_NAME) === false) continue;
            if (this.playerProxies.has(busName)) continue;

            promises.push(this.addPlayer(busName));
        }

        await Promise.all(promises).catch(handleError);
    }

    private async addPlayer(busName: string) {
        debugLog("Adding player:", busName);
        try {
            const playerProxy = new PlayerProxy(busName);
            const initSuccess = await playerProxy
                .initPlayer(this.mprisIfaceInfo, this.mprisPlayerIfaceInfo, this.propertiesIfaceInfo)
                .catch(handleError);

            if (initSuccess == null || initSuccess === false) {
                errorLog("Failed to init player:", busName);
                return;
            }

            const isPlayerBlacklisted = this.isPlayerBlacklisted(playerProxy.identity, playerProxy.desktopEntry);

            if (isPlayerBlacklisted) {
                return;
            }

            playerProxy.onChanged("IsPinned", this.setActivePlayer.bind(this));
            playerProxy.onChanged("PlaybackStatus", this.setActivePlayer.bind(this));
            playerProxy.onChanged("IsInvalid", () => {
                this.setActivePlayer();
                this.panelBtn?.updateWidgets(WidgetFlags.MENU_PLAYERS);
            });

            this.playerProxies.set(busName, [playerProxy, undefined]);
            this.panelBtn?.updateWidgets(WidgetFlags.MENU_PLAYERS);
            this.setActivePlayer();
        } catch (e) {
            errorLog("Failed to add player:", busName, e);
        }
    }

    private removePlayer(busName: string) {
        debugLog("Removing player:", busName);
        this.playerProxies.get(busName)[0]?.onDestroy();
        this.playerProxies.delete(busName);
        this.panelBtn?.updateWidgets(WidgetFlags.MENU_PLAYERS);
        this.setActivePlayer();
    }

    private setActivePlayer() {
        if (this.playerProxies.size === 0) {
            if (this.panelBtn != null) {
                this.removePanelButton();
            }

            return;
        }

        let chosenPlayer: [PlayerProxy, unknown] = null;

        for (const [, playerProxy] of this.playerProxies) {
            if (playerProxy[0].isInvalid) {
                continue;
            }

            if (playerProxy[0].isPlayerPinned()) {
                chosenPlayer = playerProxy;
                this.chosenBusName = playerProxy[0].busName;
                break;
            }

            if (chosenPlayer == null) {
                chosenPlayer = playerProxy;
                this.chosenBusName = playerProxy[0].busName;
                continue;
            }

            if (chosenPlayer && chosenPlayer[0]?.playbackStatus !== PlaybackStatus.PLAYING) {
                if (playerProxy[0].playbackStatus === PlaybackStatus.PLAYING) {
                    chosenPlayer = playerProxy;
                    this.chosenBusName = playerProxy[0].busName;
                } else if (this.panelBtn?.isSamePlayer(playerProxy[0])) {
                    chosenPlayer = playerProxy;
                    this.chosenBusName = playerProxy[0].busName;
                }
            }
        }

        debugLog("Chosen player:", chosenPlayer[0]?.busName);

        if (chosenPlayer == null) {
            this.removePanelButton();
        } else {
            if (this.panelBtn == null) {
                this.addPanelButton(chosenPlayer[0].busName);
            } else {
                this.panelBtn.updateProxy(chosenPlayer);
            }
        }
    }

    private isPlayerBlacklisted(id: string, entry: string) {
        const app = getAppByIdAndEntry(id, entry);

        if (app == null) {
            return false;
        }

        const appId = app.get_id();
        return this.blacklistedPlayers.includes(appId);
    }

    private updateMediaNotificationVisiblity(shouldReset = false) {
        if (this.mediaSectionAddFunc && (shouldReset || this.hideMediaNotification === false)) {
            Mpris.MprisSource.prototype._addPlayer = this.mediaSectionAddFunc;
            this.mediaSectionAddFunc = null;

            // @ts-expect-error nothing
            Main.panel.statusArea.dateMenu._messageList._messageView._mediaSource._onProxyReady();
        } else {
            this.mediaSectionAddFunc = Mpris.MprisSource.prototype._addPlayer;
            Mpris.MprisSource.prototype._addPlayer = function () {};

            // @ts-expect-error nothing
            if (Main.panel.statusArea.dateMenu._messageList._messageView._mediaSource._players != null) {
                // @ts-expect-error nothing
                for (const player of Main.panel.statusArea.dateMenu._messageList._messageView._mediaSource._players.values()) {
                    player._close();
                }
            }
        }
    }

    private addPanelButton(busName: string) {
        debugLog("Adding panel button");
        const playerProxy = this.playerProxies.get(busName);

        if (playerProxy == null) {
            return;
        }

        this.panelBtn = new PanelButton(playerProxy, this);
        Main.panel.addToStatusArea("Media Controls", this.panelBtn, this.extensionIndex, this.extensionPosition);
    }

    private removePanelButton() {
        debugLog("Removing panel button");
        this.panelBtn?.destroy();
        this.panelBtn = null;
    }

    private destroySettings() {
        this.settings = null;

        this.labelWidth = null;
        this.hideMediaNotification = null;
        this.scrollLabels = null;
        this.showLabel = null;
        this.showPlayerIcon = null;
        this.showControlIcons = null;
        this.showControlIconsPlay = null;
        this.showControlIconsNext = null;
        this.showControlIconsPrevious = null;
        this.showControlIconsSeekForward = null;
        this.showControlIconsSeekBackward = null;
        this.coloredPlayerIcon = null;
        this.extensionPosition = null;
        this.extensionIndex = null;
        this.elementsOrder = null;
        this.labelsOrder = null;
        this.shortcutShowMenu = null;
        this.mouseActionLeft = null;
        this.mouseActionMiddle = null;
        this.mouseActionRight = null;
        this.mouseActionDouble = null;
        this.mouseActionScrollUp = null;
        this.mouseActionScrollDown = null;
        this.cacheArt = null;
        this.blacklistedPlayers = null;
    }
}
