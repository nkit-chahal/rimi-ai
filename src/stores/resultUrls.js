import { create } from 'zustand';

const KEY_MAP = {
    pattern: 'enh',
    seamless: 'seamless',
    vectorize: 'vec',
    upscale: 'upscale',
    removebg: 'removeBg',
    colorways: 'cw',
    repeat: 'repeat',
};

export const useResultUrls = create((set) => ({
    enh: null,
    seamless: null,
    vec: null,
    upscale: null,
    removeBg: null,
    cw: null,
    repeat: null,
    qwenLaunch: null,
    set: (key, url) => {
        const mapped = KEY_MAP[key] || key;
        set({ [mapped]: url });
    },
    setRaw: (mappedKey, url) => set({ [mappedKey]: url }),
    setQwenLaunch: (launch) => set({ qwenLaunch: launch }),
    clearQwenLaunch: () => set({ qwenLaunch: null }),
}));
