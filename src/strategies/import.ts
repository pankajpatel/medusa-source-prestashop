import {
  AbstractBatchJobStrategy,
  BatchJob,
  BatchJobService,
  ProductVariantService,
  Store,
  StoreService,
} from "@medusajs/medusa";

import { EntityManager } from "typeorm";
import { Logger } from "@medusajs/medusa/dist/types/global";
import PrestashopCategoryService from "medusa-source-prestashop/src/services/prestashop-category";
import PrestashopProductService from "medusa-source-prestashop/src/services/prestashop-product";

import PrestashopClientService from "medusa-source-prestashop/src/services/prestashop-client";

type InjectedDependencies = {
  storeService: StoreService;
  prestashopClientService: PrestashopClientService;
  prestashopCategoryService: PrestashopCategoryService;
  prestashopProductService: PrestashopProductService;
  productVariantService: ProductVariantService;
  logger: Logger;
  manager: EntityManager;
  batchJobService: BatchJobService;
};

class ImportStrategy extends AbstractBatchJobStrategy {
  static identifier = "import-prestashop-strategy";
  static batchType = "import-prestashop";

  protected batchJobService_: BatchJobService;
  protected storeService_: StoreService;
  protected prestashopClientService_: PrestashopClientService;

  protected prestashopCategoryService_: PrestashopCategoryService;
  protected prestashopProductService_: PrestashopProductService;
  protected productVariantService: ProductVariantService;
  protected logger_: Logger;

  constructor(container: InjectedDependencies) {
    super(container);

    this.manager_ = container.manager;
    this.storeService_ = container.storeService;
    this.prestashopClientService_ = container.prestashopClientService;
    this.prestashopCategoryService_ = container.prestashopCategoryService;
    this.prestashopProductService_ = container.prestashopProductService;
    this.productVariantService = container.productVariantService;
    this.logger_ = container.logger;
    this.batchJobService_ = container.batchJobService;
  }

  async preProcessBatchJob(batchJobId: string): Promise<void> {
    return await this.atomicPhase_(async (transactionManager) => {
      const batchJob = await this.batchJobService_
        .withTransaction(transactionManager)
        .retrieve(batchJobId);

      await this.batchJobService_
        .withTransaction(transactionManager)
        .update(batchJob, {
          result: {
            progress: 0,
          },
        });
    });
  }

  async processJob(batchJobId: string): Promise<void> {
    const batchJob = await this.batchJobService_.retrieve(batchJobId);

    let store: Store;

    try {
      store = await this.storeService_.retrieve();
    } catch (e) {
      this.logger_.info(
        "Skipping Prestashop import since no store is created in Medusa."
      );
      return;
    }

    this.logger_.info("Importing categories from Prestashop...");
    const lastUpdatedTime = await this.getBuildTime(store);

    //retrieve categories
    // const { data } = await this.prestashopClientService_.retrieveCategories(lastUpdatedTime);
    var categories;
    const getCategories = async () => {
      categories = await this.prestashopClientService_.retrieveCategories(
        lastUpdatedTime
      );
    };

    await getCategories();

    // await categories.data.categories.map(async (category) => {
    for await (let category of categories.data.categories) {
      await this.prestashopCategoryService_.create(
        await this.prestashopClientService_.retrieveCategory(category.id)
      );
      //  if (category.id == 11) {
      //   break
      //  }
    }

    if (categories.data.categories.length) {
      this.logger_.info(
        `${categories.data.categories.length} categories have been imported or updated successfully.`
      );
    } else {
      this.logger_.info(`No categories have been imported or updated.`);
    }

    this.logger_.info("Importing products from Prestashop...");

    //retrieve configurable products
    const products = await this.prestashopClientService_.retrieveProducts();

    // const optionsId = await this.prestashopClientService_.retrieveOptionsDefaults()
    // console.log(optionsId.data)
    // const options = []
    // for await (const id of optionsId.data.product_options) {
    //   console.log(id.id)
    //   let option = await this.prestashopClientService_.retrieveOption(id.id)
    //   options.push(option.data.product_option)
    // }

    // console.log("product has combinations")
    // console.log(options)

    for (let product of products.data.products) {
      const productData = await this.prestashopClientService_.retrieveProduct(
        product.id
      );

      productData.data.product.images =
        await this.prestashopClientService_.retrieveImages(product.id);

      await this.prestashopProductService_.create(productData);
    }

    // Not necessary because there is no way to request Simple Products or Products with combinations. Just above retrieve all
    // the products and if there are combinations they will be created/updated.

    // retrieve simple products to insert those that don't belong to a configurable product
    // const simpleProducts = await this.magentoClientService_.retrieveProducts(MagentoProductTypes.SIMPLE, lastUpdatedTime);

    // for (let product of simpleProducts) {
    //   await this.magentoProductService_
    //     .create(product);
    // }

    if (products.data.products.length) {
      this.logger_.info(
        `${products.data.products.length} products have been imported or updated successfully.`
      );
    } else {
      this.logger_.info(`No products have been imported or updated.`);
    }

    await this.updateBuildTime(store);
  }

  async getBuildTime(store?: Store | null): Promise<string | null> {
    let buildtime = null;

    try {
      if (!store) {
        store = await this.storeService_.retrieve();
      }
    } catch {
      return null;
    }

    if (store.metadata?.source_prestashop_bt) {
      buildtime = store.metadata.source_prestashop_bt;
    }

    if (!buildtime) {
      return null;
    }

    return buildtime;
  }

  async updateBuildTime(store?: Store | null): Promise<void> {
    try {
      if (!store) {
        store = await this.storeService_.retrieve();
      }
    } catch {
      return null;
    }

    const payload = {
      metadata: {
        source_prestashop_bt: new Date().toISOString(),
      },
    };

    await this.storeService_.update(payload);
  }

  protected async shouldRetryOnProcessingError(
    batchJob: BatchJob,
    err: unknown
  ): Promise<boolean> {
    return true;
  }

  buildTemplate(): Promise<string> {
    throw new Error("Method not implemented.");
  }
  protected manager_: EntityManager;
  protected transactionManager_: EntityManager;
}

export default ImportStrategy;
