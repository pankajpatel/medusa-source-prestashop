import PrestashopClientService from "./prestashop-client";
import {
  ProductCollection,
  ProductCollectionService,
  TransactionBaseService,
} from "@medusajs/medusa";

import { EntityManager } from "@medusajs/typeorm";
import { PluginOptions } from "../types";
import slugify from "slugify";

type InjectedDependencies = {
  prestashopClientService: PrestashopClientService;
  productCollectionService: ProductCollectionService;
  manager: EntityManager;
};

class PrestashopCategoryService extends TransactionBaseService {
  protected manager_: EntityManager;
  protected options_: PluginOptions;
  protected transactionManager_: EntityManager;
  protected prestashopClientService_: PrestashopClientService;
  protected productCollectionService_: ProductCollectionService;

  constructor(container: InjectedDependencies, options: PluginOptions) {
    super(container);
    this.manager_ = container.manager;
    this.options_ = options;
    this.prestashopClientService_ = container.prestashopClientService;
    this.productCollectionService_ = container.productCollectionService;
  }

  async create(category: any): Promise<void> {
    return this.atomicPhase_(async (manager) => {
      //check if a collection exists for the category
      const existingCollection = await this.productCollectionService_
        .withTransaction(manager)
        .retrieveByHandle(category.data.categories?.[0]?.link_rewrite || "")
        .catch(() => undefined);

      if (existingCollection) {
        return this.update(category, existingCollection);
      }

      //create collection
      const collectionData = this.normalizeCollection(
        category.data.categories?.[0]
      );
      await this.productCollectionService_
        .withTransaction(manager)
        .create(collectionData);
    });
  }

  async update(
    category: any,
    existingCollection: ProductCollection
  ): Promise<void> {
    return this.atomicPhase_(async (manager) => {
      const collectionData = this.normalizeCollection(
        category.data.categories?.[0]
      );

      const update = {};

      for (const key of Object.keys(collectionData)) {
        if (collectionData[key] !== existingCollection[key]) {
          update[key] = collectionData[key];
        }
      }

      if (Object.values(update).length) {
        await this.productCollectionService_
          .withTransaction(manager)
          .update(existingCollection.id, update);
      }
    });
  }

  normalizeCollection(category: any): any {
    let title = category.name;
    let handle = category.link_rewrite;

    if (typeof category.name === "object" && category.name?.value) {
      title = category.name.value;
    }
    if (
      typeof category.link_rewrite === "object" &&
      category.link_rewrite?.value
    ) {
      title = category.link_rewrite.value;
    }
    return {
      title,
      handle,
      metadata: {
        prestashop_id: category.id,
      },
    };
  }

  getHandle(category: { name: string; link_rewrite?: string }) {
    return this.options_.generateNewHandles || !category.link_rewrite
      ? slugify(category.name)
      : category.link_rewrite;
  }
}

export default PrestashopCategoryService;
