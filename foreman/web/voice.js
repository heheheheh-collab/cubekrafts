/**
 * Voice, entirely in the browser.
 *
 * Both halves are the platform's: `SpeechRecognition` for listening and
 * `speechSynthesis` for speaking. No audio leaves the device and nothing is
 * uploaded — which is the reason it is done this way rather than with a
 * transcription API that would be more accurate and much worse.
 *
 * Speaking is off until you use the microphone once. Something that starts
 * talking at you unprompted is a gadget; something that answers the way you
 * asked is an assistant.
 */

const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;

class Voice {
  #recogniser = null;
  #button = null;
  #listening = false;
  #spoken = false;
  #onState = null;
  #voice = null;

  get available() {
    return Boolean(Recognition);
  }

  attach({ button, onHeard, onState }) {
    if (!button) return;
    this.#button = button;
    this.#onState = onState ?? null;
    if (!this.available) return;

    button.hidden = false;
    button.addEventListener('click', () => this.#toggle(onHeard));
  }

  #toggle(onHeard) {
    if (this.#listening) {
      this.#recogniser?.stop();
      return;
    }

    const recogniser = new Recognition();
    recogniser.lang = navigator.language || 'en-GB';
    recogniser.interimResults = false;
    recogniser.maxAlternatives = 1;
    // One utterance per press. Continuous listening would mean a microphone
    // that is always on, which is not a thing to leave running by default.
    recogniser.continuous = false;

    const state = (on) => {
      this.#listening = on;
      this.#button?.classList.toggle('listening', on);
      this.#onState?.(on);
    };

    recogniser.onstart = () => {
      this.#spoken = true;
      state(true);
    };
    recogniser.onend = () => state(false);
    recogniser.onerror = () => state(false);
    recogniser.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (text) onHeard(text);
    };

    this.#recogniser = recogniser;
    recogniser.start();
  }

  /**
   * The voice it answers in.
   *
   * British and even, because that is the register this thing is written in —
   * the charters say things plainly and a bright American default undercuts
   * them. Resolved once and cached: the list is empty on first call in some
   * browsers, so this is retried until it is not.
   */
  #pick() {
    if (this.#voice) return this.#voice;
    const voices = speechSynthesis.getVoices?.() ?? [];
    if (voices.length === 0) return null;
    const british = voices.filter((v) => v.lang === 'en-GB');
    // Named preferences first: these are the calm ones. Anything en-GB beats
    // the platform default, and the default beats nothing.
    this.#voice =
      british.find((v) => /daniel|arthur|oliver|serena|kate/i.test(v.name)) ??
      british.find((v) => !/novelty|whisper|bad news|bells/i.test(v.name)) ??
      null;
    return this.#voice;
  }

  /** Read an answer aloud, but only to someone who spoke to it first. */
  say(text) {
    if (!this.#spoken || !text) return;
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const chosen = this.#pick();
    if (chosen) utterance.voice = chosen;
    utterance.lang = chosen?.lang ?? 'en-GB';
    // A shade under natural pace and slightly low: unhurried reads as
    // competent, hurried reads as a notification.
    utterance.rate = 0.98;
    utterance.pitch = 0.92;
    speechSynthesis.speak(utterance);
  }

  hush() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }
}

export const voice = new Voice();
