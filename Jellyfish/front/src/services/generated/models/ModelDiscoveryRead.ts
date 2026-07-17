/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ModelDiscoveryItem } from './ModelDiscoveryItem';
/**
 * Provider discovery result kept separate from persisted model records.
 */
export type ModelDiscoveryRead = {
    /**
     * Provider ID
     */
    provider_id: string;
    /**
     * Discovered models
     */
    models?: Array<ModelDiscoveryItem>;
    /**
     * Discovery source: remote or fallback
     */
    source: string;
};

