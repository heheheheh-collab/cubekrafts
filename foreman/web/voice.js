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

  get available() {
    return Boolean(Recognition);
  }

  attach({ button, onHeard }) {
    if (!button) return;
    this.#button = button;
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

    recogniser.onstart = () => {
      this.#listening = true;
      this.#spoken = true;
      this.#button?.classList.add('listening');
    };
    recogniser.onend = () => {
      this.#listening = false;
      this.#button?.classList.remove('listening');
    };
    recogniser.onerror = () => {
      this.#listening = false;
      this.#button?.classList.remove('listening');
    };
    recogniser.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (text) onHeard(text);
    };

    this.#recogniser = recogniser;
    recogniser.start();
  }

  /** Read an answer aloud, but only to someone who spoke to it first. */
  say(text) {
    if (!this.#spoken || !text) return;
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || 'en-GB';
    utterance.rate = 1.05;
    speechSynthesis.speak(utterance);
  }

  hush() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }
}

export const voice = new Voice();
