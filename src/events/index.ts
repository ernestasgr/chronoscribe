type Handler<Payload> = (payload: Payload) => void;

/** A typed publish/subscribe channel: each event name carries one payload type. */
export interface EventBus<Events extends object> {
    emit<Type extends keyof Events>(type: Type, payload: Events[Type]): void;
    /** Calls `handler` on every `type` event until the returned function is called. */
    on<Type extends keyof Events>(type: Type, handler: Handler<Events[Type]>): () => void;
}

/** The half of a bus a service needs to publish facts. */
export type Emitter<Events extends object> = Pick<EventBus<Events>, "emit">;

/** The half of a bus a service needs to react to facts. */
export type Subscriber<Events extends object> = Pick<EventBus<Events>, "on">;

export function createEventBus<Events extends object>(): EventBus<Events> {
    const handlers = new Map<keyof Events, Set<Handler<never>>>();
    const of = (type: keyof Events): Set<Handler<never>> => {
        const existing = handlers.get(type);
        if (existing) return existing;
        const created = new Set<Handler<never>>();
        handlers.set(type, created);
        return created;
    };

    return {
        emit: (type, payload) => of(type).forEach((handler) => handler(payload as never)),
        on: (type, handler) => {
            of(type).add(handler);
            return () => void of(type).delete(handler);
        },
    };
}
