import type { ServerResponse } from 'node:http';

/**
 * The live channel.
 *
 * Server-sent events rather than websockets: the traffic is one-directional,
 * it survives a proxy that only understands HTTP, and the browser reconnects
 * on its own. Anything the founder should see without refreshing goes through
 * here — a run starting, an approval arriving, spend moving.
 */

export type ForemanEvent =
  | { type: 'tick'; ran: boolean; why?: string; taskId?: string | null; kind?: string }
  | { type: 'run.started'; runId: string; taskId: string; role: string }
  | { type: 'run.finished'; runId: string; outcome: string }
  | { type: 'approval.pending'; approvalId: string; tool: string; summary: string }
  | { type: 'approval.decided'; approvalId: string; decision: string }
  | { type: 'spend'; todayUsd: number; capUsd: number }
  | { type: 'spend.cap'; capUsd: number }
  | { type: 'email.suppressed'; kind: string }
  | { type: 'standup'; speech: string; needsYou: number }
  | { type: 'paused'; paused: boolean };

export class EventBus {
  private readonly clients = new Set<ServerResponse>();
  private seq = 0;

  /** Attach a response as a subscriber and keep it open. */
  subscribe(res: ServerResponse): () => void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Proxies that buffer will silently break the whole feature.
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    this.clients.add(res);

    // A comment every 25 seconds keeps intermediaries from reaping an idle
    // connection, and costs almost nothing.
    const beat = setInterval(() => {
      if (!res.writableEnded) res.write(': beat\n\n');
    }, 25_000);
    beat.unref?.();

    const close = () => {
      clearInterval(beat);
      this.clients.delete(res);
    };
    res.on('close', close);
    return close;
  }

  publish(event: ForemanEvent): void {
    const frame = `id: ${++this.seq}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) {
      if (res.writableEnded) {
        this.clients.delete(res);
        continue;
      }
      res.write(frame);
    }
  }

  get subscriberCount(): number {
    return this.clients.size;
  }

  closeAll(): void {
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
