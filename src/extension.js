/** @import { StdInterface } from './types/dbus.js' */
/** @import { KeysOf } from './types/misc.js' */
/** @import { MouseActions, PanelElements, LabelTypes } from './types/enums/common.js' */

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
import { getAppInfoByIdAndEntry, createDbusProxy } from "./utils/shell_only.js";
import {
    PlaybackStatus,
    WidgetFlags,
    MPRIS_PLAYER_IFACE_NAME,
    DBUS_PROPERTIES_IFACE_NAME,
    MPRIS_IFACE_NAME,
    DBUS_OBJECT_PATH,
    DBUS_IFACE_NAME,
    ExtensionPositions,
    LYRIC_IFACE_NAME,
    LYRIC_OBJECT_PATH
} from "./types/enums/common.js";

/** @typedef {KeysOf<typeof PanelElements>[]} ElementsOrder */
/** @typedef {(KeysOf<typeof LabelTypes> | (string & NonNullable<unknown>))[]} LabelsOrder */

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");

export default class MediaControls extends Extension {
    /**
     * @public
     * @type {number}
     */
    labelWidth;

    /**
     * @public
     * @type {boolean}
     */
    isFixedLabelWidth;

    /**
     * @public
     * @type {boolean}
     */
    scrollLabels;

    /**
     * @public
     * @type {boolean}
     */
    hideMediaNotification;

    /**
     * @public
     * @type {boolean}
     */
    showTrackSlider;

    /**
     * @public
     * @type {boolean}
     */
    showLabel;

    /**
     * @public
     * @type {boolean}
     */
    showPlayerIcon;

    /**
     * @public
     * @type {boolean}
     */
    showControlIcons;

    /**
     * @public
     * @type {boolean}
     */
    showControlIconsPlay;

    /**
     * @public
     * @type {boolean}
     */
    showControlIconsNext;

    /**
     * @public
     * @type {boolean}
     */
    showControlIconsPrevious;

    /**
     * @public
     * @type {boolean}
     */
    showControlIconsSeekForward;

    /**
     * @public
     * @type {boolean}
     */
    showControlIconsSeekBackward;

    /**
     * @public
     * @type {boolean}
     */
    coloredPlayerIcon;

    /**
     * @public
     * @type {ExtensionPositions}
     */
    extensionPosition;

    /**
     * @public
     * @type {number}
     */
    extensionIndex;

    /**
     * @public
     * @type {ElementsOrder}
     */
    elementsOrder;

    /**
     * @public
     * @type {LabelsOrder}
     */
    labelsOrder;

    /**
     * @public
     * @type {string}
     */
    shortcutShowMenu;

    /**
     * @public
     * @type {MouseActions}
     */
    mouseActionLeft;

    /**
     * @public
     * @type {MouseActions}
     */
    mouseActionMiddle;

    /**
     * @public
     * @type {MouseActions}
     */
    mouseActionRight;

    /**
     * @public
     * @type {MouseActions}
     */
    mouseActionDouble;

    /**
     * @public
     * @type {MouseActions}
     */
    mouseActionScrollUp;

    /**
     * @public
     * @type {MouseActions}
     */
    mouseActionScrollDown;

    /**
     * @public
     * @type {boolean}
     */
    cacheArt;

    /**
     * @public
     * @type {string[]}
     */
    blacklistedPlayers;

    /**
     * @private
     * @type {Gio.Settings}
     */
    settings;

    /**
     * @private
     * @type {InstanceType<typeof PanelButton>}
     */
    panelBtn;

    /**
     * @private
     * @type {StdInterface}
     */
    watchProxy;

    /**
     * @typedef {Object} LyricObj
     * @property {string} content
     * @property {number} time
     * @property {string} sender
    */

    /**
     * @private
     * @type {Map<string, [PlayerProxy, LyricObj | null]>}
     */
    playerProxies;

    /**
     * @private
     * @type {string}
    */
    chosenBusName;

    /**
     * @private
     * @type {Gio.DBusInterfaceInfo}
     */
    watchIfaceInfo;

    /**
     * @private
     * @type {Gio.DBusInterfaceInfo}
     */
    mprisIfaceInfo;

    /**
     * @private
     * @type {Gio.DBusInterfaceInfo}
     */
    mprisPlayerIfaceInfo;

    /**
     * @private
     * @type {Gio.DBusInterfaceInfo}
     */
    propertiesIfaceInfo;

    /**
     * @private
     * @type {Gio.DBusInterfaceInfo}
     */ 
    lyricIfaceInfo;

    /**
     * @private
     * @type {number}
    */
    ownerId;

    /**
     * @private
     * @type {(busName: string) => void}
     */
    mediaSectionAddFunc;

    /**
     * @public
     * @returns {void}
     */
    enable() {
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

    /**
     * @public
     * @returns {void}
     */
    disable() {
        this.playerProxies = null;
        this.destroySettings();
        this.watchIfaceInfo = null;
        this.mprisIfaceInfo = null;
        this.mprisPlayerIfaceInfo = null;
        this.propertiesIfaceInfo = null;
        this.lyricIfaceInfo = null;
        this.watchProxy = null;
        Gio.bus_unown_name(this.ownerId);
        this.removePanelButton();
        this.updateMediaNotificationVisiblity(true);
        Main.wm.removeKeybinding("mediacontrols-show-popup-menu");
        debugLog("Disabled");
    }

    /**
     * @public
     * @returns {[PlayerProxy, unknown][]}
     */
    getPlayers() {
        const players = [];
        for (const player of this.playerProxies.values()) {
            if (player[0].isInvalid) {
                continue;
            }
            players.push(player);
        }
        return players;
    }

    /**
     * @private
     * @returns {void}
     */
    initSettings() {
        this.settings = this.getSettings();
        this.labelWidth = this.settings.get_uint("label-width");
        this.isFixedLabelWidth = this.settings.get_boolean("fixed-label-width");
        this.scrollLabels = this.settings.get_boolean("scroll-labels");
        this.hideMediaNotification = this.settings.get_boolean("hide-media-notification");
        this.showTrackSlider = this.settings.get_boolean("show-track-slider");
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
        this.elementsOrder = /** @type {ElementsOrder} */ (this.settings.get_strv("elements-order"));
        this.labelsOrder = this.settings.get_strv("labels-order");
        // @ts-ignore
        this.mouseActionLeft = this.settings.get_enum("mouse-action-left");
        // @ts-ignore
        this.mouseActionMiddle = this.settings.get_enum("mouse-action-middle");
        // @ts-ignore
        this.mouseActionRight = this.settings.get_enum("mouse-action-right");
        // @ts-ignore
        this.mouseActionDouble = this.settings.get_enum("mouse-action-double");
        // @ts-ignore
        this.mouseActionScrollUp = this.settings.get_enum("mouse-action-scroll-up");
        // @ts-ignore
        this.mouseActionScrollDown = this.settings.get_enum("mouse-action-scroll-down");
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
        this.settings.connect("changed::show-track-slider", () => {
            this.showTrackSlider = this.settings.get_boolean("show-track-slider");
            this.panelBtn?.updateWidgets(WidgetFlags.MENU_SLIDER);
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
            this.elementsOrder = /** @type {ElementsOrder} */ (this.settings.get_strv("elements-order"));
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_NO_REPLACE);
        });
        this.settings.connect("changed::labels-order", () => {
            this.labelsOrder = this.settings.get_strv("labels-order");
            this.panelBtn?.updateWidgets(WidgetFlags.PANEL_LABEL);
        });
        this.settings.connect("changed::mouse-action-left", () => {
            // @ts-ignore
            this.mouseActionLeft = this.settings.get_enum("mouse-action-left");
        });
        this.settings.connect("changed::mouse-action-middle", () => {
            // @ts-ignore
            this.mouseActionMiddle = this.settings.get_enum("mouse-action-middle");
        });
        this.settings.connect("changed::mouse-action-right", () => {
            // @ts-ignore
            this.mouseActionRight = this.settings.get_enum("mouse-action-right");
        });
        this.settings.connect("changed::mouse-action-double", () => {
            // @ts-ignore
            this.mouseActionDouble = this.settings.get_enum("mouse-action-double");
        });
        this.settings.connect("changed::mouse-action-scroll-up", () => {
            // @ts-ignore
            this.mouseActionScrollUp = this.settings.get_enum("mouse-action-scroll-up");
        });
        this.settings.connect("changed::mouse-action-scroll-down", () => {
            // @ts-ignore
            this.mouseActionScrollDown = this.settings.get_enum("mouse-action-scroll-down");
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

    /**
     * @private
     * @returns {Promise<void>}
     */
    async initProxies() {
        // Load gresource for accessing D-Bus XML files
        const resourcePath = GLib.build_filenamev([this.path, "org.gnome.shell.extensions.mediacontrols.gresource"]);
        Gio.resources_register(Gio.resource_load(resourcePath));

        const mprisXmlFile = Gio.File.new_for_uri(
            "resource:///org/gnome/shell/extensions/mediacontrols/dbus/mprisNode.xml",
        );
        const watchXmlFile = Gio.File.new_for_uri(
            "resource:///org/gnome/shell/extensions/mediacontrols/dbus/watchNode.xml",
        );
        const lyricXmlFile = Gio.File.new_for_uri(
            "resource:///org/gnome/shell/extensions/mediacontrols/dbus/lyricNode.xml",
        );

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
        // @ts-expect-error
        const lyricIfaceInfoString = new GLib.String("");
        lyricInterface.generate_xml(4, lyricIfaceInfoString);
        this.lyricIfaceInfo = lyricInterface;

        const mprisNodeInfo = Gio.DBusNodeInfo.new_for_xml(mprisNodeXml);
        const mprisInterface = mprisNodeInfo.lookup_interface(MPRIS_IFACE_NAME);
        const mprisPlayerInterface = mprisNodeInfo.lookup_interface(MPRIS_PLAYER_IFACE_NAME);
        const propertiesInterface = mprisNodeInfo.lookup_interface(DBUS_PROPERTIES_IFACE_NAME);

        // @ts-expect-error
        const mprisInterfaceString = new GLib.String("");
        mprisInterface.generate_xml(4, mprisInterfaceString);
        // @ts-expect-error
        const mprisPlayerInterfaceString = new GLib.String("");
        mprisPlayerInterface.generate_xml(4, mprisPlayerInterfaceString);
        // @ts-expect-error
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
        await this.createLyricProxy().catch(handleError);
    }

    /**
     * @private
     * @returns {Promise<boolean>}
     */
    async initWatchProxy() {
        this.watchProxy = await createDbusProxy(this.watchIfaceInfo, DBUS_IFACE_NAME, DBUS_OBJECT_PATH).catch(
            handleError,
        );
        if (this.watchProxy == null) {
            return false;
        }
        // @ts-ignore
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

    /**
     * @private
     * @returns {Promise<void>}
     */
    async createLyricProxy() {
        this.ownerId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            LYRIC_IFACE_NAME,
            Gio.BusNameOwnerFlags.NONE,
            (connect) => {
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
        )
    }

    /**
     * 
     * @returns {void}
     * @param {any} connection
     * @param {string} sender
     * @param {any} object_path
     * @param {any} interface_name
     * @param {string} method_name
     * @param {{ unpack: () => any[]; }} parameters
     * @param {{ return_value: (arg0: null) => void; }} invocation
     */
    // @ts-ignore
    onNameAcquired(connection, sender, object_path, interface_name, method_name, parameters, invocation) {
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

    /**
     * @private
     * @returns {Promise<void>}
     */
    async addRunningPlayers() {
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

    /**
     * @private
     * @param {string} busName
     * @returns {Promise<void>}
     */
    async addPlayer(busName) {
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

    /**
     * @private
     * @param {string} busName
     * @returns {void}
     */
    removePlayer(busName) {
        debugLog("Removing player:", busName);
        this.playerProxies.get(busName)[0]?.onDestroy();
        this.playerProxies.delete(busName);
        this.panelBtn?.updateWidgets(WidgetFlags.MENU_PLAYERS);
        this.setActivePlayer();
    }

    /**
     * @private
     * @returns {void}
     */
    setActivePlayer() {
        if (this.playerProxies.size === 0) {
            if (this.panelBtn != null) {
                this.removePanelButton();
            }
            return;
        }
        let chosenPlayer = null;
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

    /**
     * @private
     * @param {string} id
     * @param {string} entry
     * @returns {boolean}
     */
    isPlayerBlacklisted(id, entry) {
        const app = getAppInfoByIdAndEntry(id, entry);
        if (app == null) {
            return false;
        }
        const appId = app.get_id();
        return this.blacklistedPlayers.includes(appId);
    }

    /**
     * @private
     * @param {boolean} [shouldReset=false]
     * @returns {void}
     */
    updateMediaNotificationVisiblity(shouldReset = false) {
        if (this.mediaSectionAddFunc && (shouldReset || this.hideMediaNotification === false)) {
            Mpris.MprisSource.prototype._addPlayer = this.mediaSectionAddFunc;
            this.mediaSectionAddFunc = null;
            // @ts-expect-error
            Main.panel.statusArea.dateMenu._messageList._messageView._mediaSource._onProxyReady();
        } else {
            this.mediaSectionAddFunc = Mpris.MprisSource.prototype._addPlayer;
            Mpris.MprisSource.prototype._addPlayer = function () {};
            // @ts-expect-error
            if (Main.panel.statusArea.dateMenu._messageList._messageView._mediaSource._players != null) {
                // @ts-expect-error
                for (const player of Main.panel.statusArea.dateMenu._messageList._messageView._mediaSource._players.values()) {
                    // @ts-expect-error
                    Main.panel.statusArea.dateMenu._messageList._messageView._mediaSource._onNameOwnerChanged(
                        null,
                        null,
                        [player._busName, player._busName, ""],
                    );
                }
            }
        }
    }

    /**
     * @private
     * @param {string} busName
     * @returns {void}
     */
    addPanelButton(busName) {
        debugLog("Adding panel button");
        const playerProxy = this.playerProxies.get(busName);
        if (playerProxy == null) {
            return;
        }
        this.panelBtn = new PanelButton(playerProxy, this);
        Main.panel.addToStatusArea("Media Controls", this.panelBtn, this.extensionIndex, this.extensionPosition);
    }

    /**
     * @private
     * @returns {void}
     */
    removePanelButton() {
        debugLog("Removing panel button");
        this.panelBtn?.destroy();
        this.panelBtn = null;
    }

    /**
     * @private
     * @returns {void}
     */
    destroySettings() {
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
