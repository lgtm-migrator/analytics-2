import { useCallback, useEffect } from 'react';
import { useLatest, useLocalStorage, useQueue } from 'react-use';

import { useAnalyticsContext } from '../context';
import { stringify } from '../lib';
import type { DeferredIdentity, PrezlyMeta } from '../types';
import { TrackingPolicy } from '../types';
import { version } from '../version';

const DEFERRED_IDENTITY_STORAGE_KEY = 'prezly_ajs_deferred_identity';

export function useAnalytics() {
    const { analytics, consent, isEnabled, newsroom, story, trackingPolicy } =
        useAnalyticsContext();
    const { uuid: newsroomUuid } = newsroom;
    const { uuid: storyUuid } = story || { uuid: undefined };

    // We use ref to `analytics` object, cause our tracking calls are added to the callback queue, and those need to have access to the most recent instance if `analytics`,
    // which would not be possible when passing the `analytics` object directly
    const analyticsRef = useLatest(analytics);
    const [deferredIdentity, setDeferredIdentity, removeDeferredIdentity] =
        useLocalStorage<DeferredIdentity>(DEFERRED_IDENTITY_STORAGE_KEY);
    const {
        add: addToQueue,
        remove: removeFromQueue,
        first: firstInQueue,
    } = useQueue<Function>([]);

    const buildOptions = useCallback(() => {
        const context: any = {
            library: {
                name: '@prezly/analytics-next',
                version,
            },
        };

        // Only inject user information when consent is given
        if (consent) {
            context.userAgent = navigator.userAgent;
        }

        return { context };
    }, [consent]);

    // The prezly traits should be placed in the root of the event when sent to the API.
    // This is handled by the `normalizePrezlyMeta` plugin.
    const injectPrezlyMeta = useCallback(
        (traits: object): object & PrezlyMeta => ({
            ...traits,
            prezly: {
                newsroom: newsroomUuid,
                ...(storyUuid && {
                    story: storyUuid,
                }),
                ...(trackingPolicy !== TrackingPolicy.DEFAULT && {
                    tracking_policy: trackingPolicy,
                }),
            },
        }),
        [newsroomUuid, storyUuid, trackingPolicy],
    );

    const identify = useCallback(
        (userId: string, traits: object = {}, callback?: () => void) => {
            const extendedTraits = injectPrezlyMeta(traits);

            if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.log(`analytics.identify(${stringify(userId, extendedTraits)})`);
            }

            if (trackingPolicy === TrackingPolicy.CONSENT_TO_IDENTIFY && !consent) {
                setDeferredIdentity({ userId, traits: extendedTraits });
                if (callback) {
                    callback();
                }

                return;
            }

            addToQueue(() => {
                if (analyticsRef.current && analyticsRef.current.identify) {
                    analyticsRef.current.identify(userId, extendedTraits, buildOptions(), callback);
                }
            });
        },
        // The `react-hooks` plugin doesn't recognize the ref returned from `useLatest` hook as a Ref.
        // Please be cautious about the dependencies for this callback!
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [addToQueue, buildOptions, consent, setDeferredIdentity, trackingPolicy, injectPrezlyMeta],
    );

    const alias = useCallback(
        (userId: string, previousId: string) => {
            if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.log(`analytics.alias(${stringify(userId, previousId)})`);
            }

            addToQueue(() => {
                if (analyticsRef.current && analyticsRef.current.alias) {
                    analyticsRef.current.alias(userId, previousId, buildOptions());
                }
            });
        },
        // The `react-hooks` plugin doesn't recognize the ref returned from `useLatest` hook as a Ref.
        // Please be cautious about the dependencies for this callback!
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [addToQueue, buildOptions],
    );

    const page = useCallback(
        (category?: string, name?: string, properties: object = {}, callback?: () => void) => {
            const extendedProperties = injectPrezlyMeta(properties);

            if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.log(`analytics.page(${stringify(category, name, extendedProperties)})`);
            }

            addToQueue(() => {
                if (analyticsRef.current && analyticsRef.current.page) {
                    analyticsRef.current.page(
                        category,
                        name,
                        extendedProperties,
                        buildOptions(),
                        callback,
                    );
                }
            });
        },
        // The `react-hooks` plugin doesn't recognize the ref returned from `useLatest` hook as a Ref.
        // Please be cautious about the dependencies for this callback!
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [addToQueue, buildOptions, injectPrezlyMeta],
    );

    const track = useCallback(
        (event: string, properties: object = {}, callback?: () => void) => {
            const extendedProperties = injectPrezlyMeta(properties);

            if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.log(`analytics.track(${stringify(event, extendedProperties)})`);
            }

            addToQueue(() => {
                if (analyticsRef.current && analyticsRef.current.track) {
                    analyticsRef.current.track(event, extendedProperties, buildOptions(), callback);
                }
            });
        },
        // The `react-hooks` plugin doesn't recognize the ref returned from `useLatest` hook as a Ref.
        // Please be cautious about the dependencies for this callback!
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [addToQueue, buildOptions, injectPrezlyMeta],
    );

    const user = useCallback(() => {
        if (analytics && analytics.user) {
            return analytics.user();
        }

        // Return fake user API to keep code working even without analytics.js loaded
        return {
            id() {
                return null;
            },
        };
    }, [analytics]);

    useEffect(() => {
        // We are using simple queue to trigger tracking calls
        // that might have been created before analytics.js was loaded.
        if (analytics && firstInQueue) {
            firstInQueue();
            removeFromQueue();
        }
    }, [firstInQueue, analytics, removeFromQueue]);

    useEffect(() => {
        if (consent) {
            if (deferredIdentity) {
                const { userId, traits } = deferredIdentity;
                identify(userId, traits);
                removeDeferredIdentity();
            }
        } else {
            const id = user().id();
            if (id) {
                setDeferredIdentity({ userId: id });
            }

            user().id(null); // erase user ID
        }
    }, [consent, deferredIdentity, identify, user, removeDeferredIdentity, setDeferredIdentity]);

    if (!isEnabled) {
        return {
            alias: () => {},
            identify: () => {},
            page: () => {},
            track: () => {},
            user,
        };
    }

    // TODO: Expose all methods of analytics-next (might not be needed, since we already provide the `analytics` object)
    return {
        alias,
        identify,
        newsroom,
        page,
        track,
        user,
    };
}
