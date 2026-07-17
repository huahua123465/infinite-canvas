/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ModelCategoryKey } from './ModelCategoryKey';
/**
 * A model returned by a provider discovery operation.
 */
export type ModelDiscoveryItem = {
    /**
     * Provider model name
     */
    name: string;
    /**
     * Model capability category
     */
    category: ModelCategoryKey;
    /**
     * Model capability description
     */
    description?: string;
};

