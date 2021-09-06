// Based on https://github.com/mheine/gnome-shell-spotify-label/blob/master/prefs.js

"use strict";

const Lang = imports.lang;

const { Gio, Gtk, GObject, GLib } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { Utf8ArrayToStr, execCommunicate } = Me.imports.utils;

const Config = imports.misc.config;
const [major] = Config.PACKAGE_VERSION.split(".");
const shellVersion = Number.parseInt(major);

const positions = ["left", "center", "right"];
const mouseActionNamesMap = {
    none: "None",
    toggle_play: "Toggle play/pause",
    play: "Play",
    pause: "Pause",
    next: "Next",
    previous: "Previous",
    toggle_menu: "Open sources menu",
};
let mouseActionNameIds = Object.keys(mouseActionNamesMap);

const presetSepChars = [
    "|...|",
    "[...]",
    "(...)",
    "{...}",
    "/...\\",
    "\\.../",
    ":...:",
    "-...-",
    "_..._",
    "=...=",
    "•...•",
    "█...█",
];

const elements = {
    icon: "Player icon",
    title: "Track title",
    controls: "Control icons",
    menu: "Sources menu",
};
const elementIds = Object.keys(elements);

let settings,
    builder,
    MediaControlsBuilderScope,
    widgetPreset,
    widgetCustom,
    widgetCacheSize,
    widgetElementOrder,
    elementOrderWidgets;

let elementOrder, elementOrderLock;

if (shellVersion >= 40) {
    MediaControlsBuilderScope = GObject.registerClass(
        { Implements: [Gtk.BuilderScope] },
        class MediaControlsBuilderScope extends GObject.Object {
            vfunc_create_closure(builder, handlerName, flags, connectObject) {
                if (typeof signalHandler[handlerName] !== "undefined") {
                    return signalHandler[handlerName].bind(connectObject || this);
                }
            }
        }
    );
}

const signalHandler = {
    on_seperator_character_group_changed: (widget) => {
        let label = widget.get_label();
        let active = widget.get_active();
        if (label === "Preset" && active) {
            widgetCustom.set_sensitive(false);
            widgetPreset.set_sensitive(true);
            signalHandler.on_seperator_preset_changed(widgetPreset);
        } else if (label === "Custom" && active) {
            widgetPreset.set_sensitive(false);
            widgetCustom.set_sensitive(true);
            signalHandler.on_seperator_custom_changed(widgetCustom);
        }
    },
    on_seperator_preset_changed: (widget) => {
        if (builder.get_object("preset-radio-btn").get_active()) {
            let presetValue = presetSepChars[widget.get_active()];
            settings.set_strv("seperator-chars", [
                presetValue.charAt(0),
                presetValue.charAt(presetValue.length - 1),
            ]);
        }
    },
    on_seperator_custom_changed: (widget) => {
        if (builder.get_object("custom-radio-btn").get_active()) {
            let customValues = widget.get_text().split("...");
            if (customValues[0] && customValues[1]) {
                settings.set_strv("seperator-chars", [customValues[0], customValues[1]]);
            }
        }
    },
    // on_element_order_first_changed: (widget) => {
    //     let secondValue = elementIds[widgetElementOrderSecond.get_active()];
    //     let thirdValue = elementIds[widgetElementOrderThird.get_active()];
    //     let thisValue = elementIds[widget.get_active()];
    //     if (thisValue === secondValue) {
    //         elementIds.forEach((element, index) => {
    //             if (!(element === thirdValue || element === thisValue)) {
    //                 widgetElementOrderSecond.set_active(index);
    //             }
    //         });
    //     } else if (thisValue === thirdValue) {
    //         elementIds.forEach((element, index) => {
    //             if (!(element === secondValue || element === thisValue)) {
    //                 widgetElementOrderThird.set_active(index);
    //             }
    //         });
    //     }
    //     settings.set_strv("element-order", [
    //         thisValue,
    //         elementIds[widgetElementOrderSecond.get_active()],
    //         elementIds[widgetElementOrderThird.get_active()],
    //     ]);
    // },
    // on_element_order_second_changed: (widget) => {
    //     let firstValue = elementIds[widgetElementOrderFirst.get_active()];
    //     let thirdValue = elementIds[widgetElementOrderThird.get_active()];
    //     let thisValue = elementIds[widget.get_active()];
    //     if (thisValue === firstValue) {
    //         elementIds.forEach((element, index) => {
    //             if (!(element === thirdValue || element === thisValue)) {
    //                 widgetElementOrderFirst.set_active(index);
    //             }
    //         });
    //     } else if (thisValue === thirdValue) {
    //         elementIds.forEach((element, index) => {
    //             if (!(element === firstValue || element === thisValue)) {
    //                 widgetElementOrderThird.set_active(index);
    //             }
    //         });
    //     }
    //     settings.set_strv("element-order", [
    //         elementIds[widgetElementOrderFirst.get_active()],
    //         thisValue,
    //         elementIds[widgetElementOrderThird.get_active()],
    //     ]);
    // },
    // on_element_order_third_changed: (widget) => {
    //     let secondValue = elementIds[widgetElementOrderSecond.get_active()];
    //     let firstValue = elementIds[widgetElementOrderFirst.get_active()];
    //     let thisValue = elementIds[widget.get_active()];
    //     if (thisValue === secondValue) {
    //         elementIds.forEach((element, index) => {
    //             if (!(element === firstValue || element === thisValue)) {
    //                 widgetElementOrderSecond.set_active(index);
    //             }
    //         });
    //     } else if (thisValue === firstValue) {
    //         elementIds.forEach((element, index) => {
    //             if (!(element === secondValue || element === thisValue)) {
    //                 widgetElementOrderFirst.set_active(index);
    //             }
    //         });
    //     }
    //     settings.set_strv("element-order", [
    //         elementIds[widgetElementOrderFirst.get_active()],
    //         elementIds[widgetElementOrderSecond.get_active()],
    //         thisValue,
    //     ]);
    // },
    on_mouse_actions_left_changed: (widget) => {
        let currentMouseActions = settings.get_strv("mouse-actions");
        currentMouseActions[0] = mouseActionNameIds[widget.get_active()];
        settings.set_strv("mouse-actions", currentMouseActions);
    },
    on_mouse_actions_right_changed: (widget) => {
        let currentMouseActions = settings.get_strv("mouse-actions");
        currentMouseActions[1] = mouseActionNameIds[widget.get_active()];
        settings.set_strv("mouse-actions", currentMouseActions);
    },
    on_extension_position_changed: (widget) => {
        settings.set_string("extension-position", positions[widget.get_active()]);
    },

    on_clear_cache_clicked: () => {
        let dir = GLib.get_user_config_dir() + "/media-controls";
        try {
            (async () => {
                await execCommunicate(["rm", "-r", dir]);
                widgetCacheSize.set_text(await getCacheSize());
            })();
        } catch (error) {
            widgetCacheSize.set_text("Failed to clear cache");
        }
    },
};

const bindSettings = () => {
    settings.bind(
        "max-text-width",
        builder.get_object("max-text-width"),
        "value",
        Gio.SettingsBindFlags.DEFAULT
    );
    settings.bind("update-delay", builder.get_object("update-delay"), "value", Gio.SettingsBindFlags.DEFAULT);
    settings.bind("show-text", builder.get_object("show-text"), "active", Gio.SettingsBindFlags.DEFAULT);
    settings.bind(
        "show-player-icon",
        builder.get_object("show-player-icon"),
        "active",
        Gio.SettingsBindFlags.DEFAULT
    );
    settings.bind(
        "show-control-icons",
        builder.get_object("show-control-icons"),
        "active",
        Gio.SettingsBindFlags.DEFAULT
    );
    settings.bind(
        "show-seperators",
        builder.get_object("show-seperators"),
        "active",
        Gio.SettingsBindFlags.DEFAULT
    );
    settings.bind(
        "colored-player-icon",
        builder.get_object("colored-player-icon"),
        "active",
        Gio.SettingsBindFlags.DEFAULT
    );
    settings.bind(
        "show-all-on-hover",
        builder.get_object("show-all-on-hover"),
        "active",
        Gio.SettingsBindFlags.DEFAULT
    );
    settings.bind(
        "extension-index",
        builder.get_object("extension-index"),
        "value",
        Gio.SettingsBindFlags.DEFAULT
    );
    settings.bind(
        "show-sources-menu",
        builder.get_object("show-sources-menu"),
        "active",
        Gio.SettingsBindFlags.DEFAULT
    );
};

const initWidgets = () => {
    // Init presets combobox
    presetSepChars.forEach((preset) => {
        widgetPreset.append(preset, preset);
    });
    let savedSepChars = settings.get_strv("seperator-chars");
    let sepChars = `${savedSepChars[0]}...${savedSepChars[1]}`;
    if (presetSepChars.includes(sepChars)) {
        builder.get_object("preset-radio-btn").set_active(true);
        widgetPreset.set_active(presetSepChars.indexOf(sepChars));
        widgetCustom.set_sensitive(false);
    } else {
        builder.get_object("custom-radio-btn").set_active(true);
        widgetCustom.set_text(sepChars);
        widgetPreset.set_active(0);
        widgetPreset.set_sensitive(false);
    }

    // Init extension position combobox
    let widgetExtensionPos = builder.get_object("extension-position");
    positions.forEach((position) => {
        widgetExtensionPos.append(position, position);
    });
    widgetExtensionPos.set_active(positions.indexOf(settings.get_string("extension-position")));

    // Init element order comboboxes
    // elementIds.forEach((element) => {
    //     widgetElementOrderFirst.append(element, elements[element]);
    //     widgetElementOrderSecond.append(element, elements[element]);
    //     widgetElementOrderThird.append(element, elements[element]);
    // });
    // let elementOrder = settings.get_strv("element-order");
    // widgetElementOrderFirst.set_active(elementIds.indexOf(elementOrder[0]));
    // widgetElementOrderSecond.set_active(elementIds.indexOf(elementOrder[1]));
    // widgetElementOrderThird.set_active(elementIds.indexOf(elementOrder[2]));

    elementOrder = settings.get_strv("element-order");

    elementIds.forEach((element, index) => {
        let widget = new Gtk.ComboBoxText({
            visible: true,
        });

        elementIds.forEach((_element) => {
            widget.append(_element, elements[_element]);
        });

        widget.set_active(elementIds.indexOf(elementOrder[index]));

        widget.connect("changed", () => {
            if (!elementOrderLock) {
                elementOrderLock = true;
                let newElementOrder = [];
                elementOrder = settings.get_strv("element-order");
                elementOrderWidgets.forEach((_widget, index) => {
                    let val = elementIds[_widget.get_active()];
                    log(`Current value: ${val}`);
                    if (newElementOrder.includes(val)) {
                        log(`   Current: ${newElementOrder} at index ${index}`);
                        let _index = newElementOrder.indexOf(val);
                        log(`   Index of conflicting element ${_index}`);
                        if (elementOrder[_index] === val) {
                            log(
                                `       This is the new one. Overriding old value: '${val}' at index: '${_index}' with '${elementOrder[index]}'`
                            );
                            newElementOrder[_index] = elementOrder[index];
                            log(`       Changed: ${newElementOrder} at index ${index}`);
                            elementOrderWidgets[_index].set_active(elementIds.indexOf(elementOrder[index]));
                        } else {
                            log(
                                `       This is the old one. Overriding current value: ${val} with ${elementOrder[_index]}`
                            );
                            val = elementOrder[_index];
                            _widget.set_active(elementIds.indexOf(val));
                        }
                    }
                    newElementOrder.push(val);
                });
                log(`Finalized ${newElementOrder}`);
                settings.set_strv("element-order", newElementOrder);
                elementOrderLock = false;
            } else {
                log("Ignoring signal");
            }
        });

        widgetElementOrder.attach(widget, 1, index, 1, 1);
        elementOrderWidgets.push(widget);
    });

    // Init mouse action comboboxes
    let widgetMouseActionLeft = builder.get_object("mouse-actions-left");
    let widgetMouseActionRight = builder.get_object("mouse-actions-right");
    mouseActionNameIds.forEach((action) => {
        widgetMouseActionLeft.append(action, mouseActionNamesMap[action]);
        widgetMouseActionRight.append(action, mouseActionNamesMap[action]);
    });
    let mouseActions = settings.get_strv("mouse-actions");
    widgetMouseActionLeft.set_active(mouseActionNameIds.indexOf(mouseActions[0]));
    widgetMouseActionRight.set_active(mouseActionNameIds.indexOf(mouseActions[1]));

    (async () => {
        widgetCacheSize.set_text(await getCacheSize());
    })();
};

const init = () => {
    settings = ExtensionUtils.getSettings();
};

const buildPrefsWidget = () => {
    builder = new Gtk.Builder();
    if (shellVersion < 40) {
        builder.add_from_file(Me.dir.get_path() + "/prefs3.ui");
        builder.connect_signals_full((builder, object, signal, handler) => {
            object.connect(signal, signalHandler[handler].bind(this));
        });
    } else {
        builder.set_scope(new MediaControlsBuilderScope());
        builder.add_from_file(Me.dir.get_path() + "/prefs4.ui");
    }
    widgetPreset = builder.get_object("sepchars-preset");
    widgetCustom = builder.get_object("sepchars-custom");
    widgetCacheSize = builder.get_object("cache-size");
    widgetElementOrder = builder.get_object("element-order");
    elementOrderWidgets = [];
    initWidgets();
    bindSettings();
    return builder.get_object("main_prefs");
};

const getCacheSize = async () => {
    // du -hs ./.config/media-controls | awk '{NF=1}1'
    try {
        let dir = GLib.get_user_config_dir() + "/media-controls";
        const result = await execCommunicate(["/bin/bash", "-c", `du -hs ${dir} | awk '{NF=1}1'`]);
        return result || "0K";
    } catch (error) {
        logError(error);
    }
};
