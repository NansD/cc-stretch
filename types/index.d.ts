declare module 'claude-code' {
  interface PluginState {
    'cc-stretch': {
      /** Per paragraph of a reply drawn by a Client: the keys of the stretches the reader has open. */
      open: StateFamily<string[]>
      /** Short forms of the stretches the reader opened since their last prompt. */
      seen: string[]
      /** Per group of tool calls: whether the reader opened it. */
      groups: StateFamily<boolean>
      /**
       * Per reply: the count each open stretch was opened at, which picks its colour, keyed
       * `<paragraph>#<stretch key>`, and the count the next one opened takes.
       */
      order: StateFamily<{ order: Record<string, number>; count: number }>
      /** The request id of the reply in which a stretch was opened last, until the next prompt; empty for none. */
      newest: string
      /**
       * Per paragraph of a reply drawn by a Client: the stretch the reader last asked to open or close
       * from the keyboard, numbered so each ask acts once; null before any.
       */
      ask: StateFamily<Shaped<{ key: string; action: 'open' | 'close'; n: number } | null>>
      /**
       * While letters show, until the next key or a submitted prompt: whether they open or close,
       * and each one's stretch, by paragraph member and stretch key; null while none show.
       */
      lettering: Shaped<{ action: 'open' | 'close'; targets: { letter: string; member: string; key: string }[] } | null>
    }
  }
}
