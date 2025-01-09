// import GLib from 'gi://GLib';

export class Service {
    _impl;
    LikeThisTrack(liked: boolean) {
        console.log("liked = ", liked);
        console.log("11111111111111", this._impl);
    }

    UpdateLyric(current_lyric: string) {
        console.log("current_lyric = ", current_lyric);
        // return this._impl.UpdateLyric(current_lyric)
    }

    emit(name: string, ...args: unknown[]) {
        this._impl.emit_signal(name, ...args);
        console.log("emit", name, ...args);
    }
}
