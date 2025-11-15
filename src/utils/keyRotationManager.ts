import { KeyRotationConfig, KeyRotationLogger } from '../types';

type KeyRotationTrigger = 'usage-limit' | 'rate-limit' | 'manual' | 'renewal';

interface KeyStats {
  count: number;
  windowStart: number;
}

interface KeyRotationManagerOptions {
  initialKey?: string;
  config: KeyRotationConfig;
  logger?: KeyRotationLogger;
  debug?: boolean;
}

export class KeyRotationManager {
  private readonly logger: KeyRotationLogger | undefined;
  private readonly debugEnabled: boolean;
  private readonly usageLimit: number;
  private readonly usageWindowMs?: number;
  private readonly cooldownMs?: number;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly keys: string[];
  private readonly usageByKey: Map<string, KeyStats>;
  private readonly config: KeyRotationConfig;
  private currentKey: string;
  private cooldownUntil = 0;
  private lastRotationReason: KeyRotationTrigger | null = null;
  private rotationInFlight: Promise<void> | null = null;
  private lock: Promise<void> = Promise.resolve();

  constructor(options: KeyRotationManagerOptions) {
    if (!options.config) {
      throw new Error('KeyRotationManager requires a configuration object.');
    }

    const { config, initialKey, logger, debug } = options;

    if (!config.usageLimit || config.usageLimit <= 0) {
      throw new Error('KeyRotationManager requires a positive usageLimit.');
    }

    this.logger = logger;
    this.debugEnabled = debug ?? false;
    this.config = config;
    this.usageLimit = config.usageLimit;
    this.usageWindowMs = config.usageWindowMs;
    this.cooldownMs = config.cooldownMs;
    this.retryAttempts = config.retryAttempts ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 500;

    const uniqueKeys = new Set<string>();
    if (initialKey) {
      uniqueKeys.add(initialKey);
    }
    for (const key of config.additionalKeys ?? []) {
      if (key) {
        uniqueKeys.add(key);
      }
    }

    if (uniqueKeys.size === 0) {
      throw new Error('KeyRotationManager requires at least one API key.');
    }

    this.keys = Array.from(uniqueKeys);
    this.currentKey = this.keys[0];
    this.logDebug('Initialized KeyRotationManager.', {
      keyCount: this.keys.length,
      currentKeySuffix: this.currentKey.slice(-6),
    });

    const now = Date.now();
    this.usageByKey = new Map(
      this.keys.map((key) => [
        key,
        {
          count: 0,
          windowStart: now,
        } as KeyStats,
      ]),
    );
  }

  public async getActiveKey(): Promise<string> {
    await this.ensureCooldown();
    await this.withLock(async () => {
      this.resetWindowIfExpired(this.currentKey);
    });
    return this.currentKey;
  }

  public async markSuccess(): Promise<void> {
    let shouldRotate = false;
    await this.withLock(async () => {
      const stats = this.getStats(this.currentKey);
      this.resetWindowIfExpired(this.currentKey);
      stats.count += 1;
      this.logDebug('Marked success for current key.', {
        keySuffix: this.currentKey.slice(-6),
        usageCount: stats.count,
        usageLimit: this.usageLimit,
      });
      if (stats.count >= this.usageLimit) {
        shouldRotate = true;
      }
    });

    if (shouldRotate) {
      await this.rotate('usage-limit');
    }
  }

  public async markRateLimit(): Promise<void> {
    await this.rotate('rate-limit');
  }

  public async markFailure(): Promise<void> {
    // This method is a placeholder for future failure tracking if needed.
  }

  public async forceRotate(): Promise<void> {
    await this.rotate('manual');
  }

  public getCurrentKey(): string {
    return this.currentKey;
  }

  public getLastRotationReason(): KeyRotationTrigger | null {
    return this.lastRotationReason;
  }

  private async rotate(reason: KeyRotationTrigger): Promise<void> {
    this.logDebug('Attempting key rotation.', { reason });
    if (this.rotationInFlight) {
      await this.rotationInFlight;
      return;
    }

    const pending = this.executeRotate(reason).finally(() => {
      this.rotationInFlight = null;
    });

    this.rotationInFlight = pending;
    await pending;
  }

  private async executeRotate(reason: KeyRotationTrigger): Promise<void> {
    let selectedKey: string | null = null;
    let needsRenewal = false;

    await this.withLock(async () => {
      const next = this.findNextUsableKey();
      if (next) {
        selectedKey = next;
        this.logDebug('Found next usable key.', { keySuffix: next.slice(-6) });
        return;
      }

      if (this.config.renewal) {
        needsRenewal = true;
        return;
      }

      if (this.cooldownMs) {
        this.cooldownUntil = Date.now() + this.cooldownMs;
      }

      const stats = this.getStats(this.currentKey);
      stats.count = 0;
      stats.windowStart = Date.now();
      this.logger?.warn?.('All API keys exhausted; reusing current key after reset.', {
        reason,
      });
    });

    if (selectedKey) {
      await this.withLock(async () => {
        this.setCurrentKey(selectedKey!, reason);
      });
      return;
    }

    if (needsRenewal) {
      const newKey = await this.fetchNewKeyWithRetry();
      if (newKey) {
        await this.withLock(async () => {
          if (!this.keys.includes(newKey)) {
            this.keys.push(newKey);
            this.logDebug('Added renewed key to rotation set.', {
              keySuffix: newKey.slice(-6),
              totalKeys: this.keys.length,
            });
          }
          this.usageByKey.set(newKey, {
            count: 0,
            windowStart: Date.now(),
          });
          this.setCurrentKey(newKey, 'renewal');
        });
      } else {
        await this.withLock(async () => {
          if (this.cooldownMs) {
            this.cooldownUntil = Date.now() + this.cooldownMs;
          }
          const stats = this.getStats(this.currentKey);
          stats.count = 0;
          stats.windowStart = Date.now();
          this.logger?.error?.('Key renewal failed; continuing with existing key after reset.');
        });
      }
    }
  }

  private setCurrentKey(key: string, reason: KeyRotationTrigger): void {
    this.currentKey = key;
    this.cooldownUntil = 0;
    this.lastRotationReason = reason;
    const stats = this.getStats(key);
    stats.count = 0;
    stats.windowStart = Date.now();
    this.logger?.info?.('Rotated API key.', { reason, keySuffix: key.slice(-6) });
  }

  private findNextUsableKey(): string | null {
    if (this.keys.length <= 1) {
      this.logDebug('Key rotation skipped: only one key available.');
      return null;
    }

    const now = Date.now();
    const currentIndex = this.keys.indexOf(this.currentKey);
    for (let offset = 1; offset < this.keys.length + 1; offset++) {
      const candidateKey = this.keys[(currentIndex + offset) % this.keys.length];

      if (candidateKey === this.currentKey) {
        break;
      }

      const stats = this.getStats(candidateKey);
      if (this.usageWindowMs && now - stats.windowStart >= this.usageWindowMs) {
        stats.count = 0;
        stats.windowStart = now;
      }

      if (stats.count < this.usageLimit) {
        return candidateKey;
      }
    }

    return null;
  }

  private async fetchNewKeyWithRetry(): Promise<string | null> {
    const renewal = this.config.renewal;
    const globalFetch = (globalThis as any).fetch as ((...args: any[]) => Promise<any>) | undefined;

    if (!renewal || typeof globalFetch !== 'function') {
      return null;
    }

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const AbortCtrl = (globalThis as any).AbortController;
        const controller =
          renewal.timeoutMs && typeof AbortCtrl === 'function' ? new AbortCtrl() : undefined;
        const timeoutId =
          renewal.timeoutMs && controller
            ? setTimeout(() => controller.abort(), renewal.timeoutMs)
            : undefined;

        const response = await globalFetch(renewal.endpoint, {
          method: renewal.method ?? 'GET',
          headers: renewal.headers,
          body: this.prepareRenewalBody(renewal),
          signal: controller ? controller.signal : undefined,
        });

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          throw new Error(`Renewal endpoint responded with status ${response.status}`);
        }

        const payload = await response.json();
        const keyPath = renewal.keyPath ?? 'apiKey';
        const newKey = keyPath ? KeyRotationManager.resolvePath(payload, keyPath) : payload;

        if (!newKey || typeof newKey !== 'string') {
          throw new Error('Renewal response did not include a valid API key.');
        }

        const trimmedKey = newKey.trim();
        if (!trimmedKey) {
          throw new Error('Renewal response provided an empty API key.');
        }

        this.logger?.info?.('Successfully fetched a new API key from renewal endpoint.');
        return trimmedKey;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger?.warn?.('Key renewal attempt failed.', { attempt, message });
        if (attempt < this.retryAttempts) {
          await KeyRotationManager.delay(this.retryDelayMs);
        }
      }
    }

    return null;
  }

  private prepareRenewalBody(renewal: NonNullable<KeyRotationConfig['renewal']>): string | undefined {
    if (!renewal.body) {
      return undefined;
    }
    if (typeof renewal.body === 'string') {
      return renewal.body;
    }
    return JSON.stringify(renewal.body);
  }

  private async ensureCooldown(): Promise<void> {
    let waitMs = 0;

    await this.withLock(async () => {
      if (this.cooldownUntil > Date.now()) {
        waitMs = this.cooldownUntil - Date.now();
      }
    });

    if (waitMs > 0) {
      this.logger?.info?.('Waiting for cooldown before reusing API key.', { waitMs });
      await KeyRotationManager.delay(waitMs);
      await this.withLock(async () => {
        this.cooldownUntil = 0;
      });
    }
  }

  private resetWindowIfExpired(key: string): void {
    const stats = this.getStats(key);
    if (!this.usageWindowMs) {
      return;
    }
    const now = Date.now();
    if (now - stats.windowStart >= this.usageWindowMs) {
      stats.count = 0;
      stats.windowStart = now;
    }
  }

  private getStats(key: string): KeyStats {
    let stats = this.usageByKey.get(key);
    if (!stats) {
      stats = {
        count: 0,
        windowStart: Date.now(),
      };
      this.usageByKey.set(key, stats);
    }
    return stats;
  }

  private async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.lock;
    let release: (() => void) | undefined;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      if (release) {
        release();
      }
    }
  }

  private static resolvePath(payload: any, path: string): any {
    if (!path) {
      return payload;
    }
    return path
      .split(/[.[\]]+/)
      .filter(Boolean)
      .reduce((acc: any, segment) => {
        if (acc == null) {
          return undefined;
        }
        if (Array.isArray(acc)) {
          const index = Number(segment);
          return Number.isInteger(index) ? acc[index] : undefined;
        }
        return acc[segment];
      }, payload);
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private logDebug(message: string, context?: Record<string, unknown>): void {
    if (!this.debugEnabled) {
      return;
    }
    if (this.logger?.debug) {
      this.logger.debug(message, context);
    } else {
      this.logger?.info?.(message, context);
    }
  }
}
