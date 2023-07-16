import {
  DefaultFileService,
  CurrencyService,
  Product,
  ProductCollectionService,
  ProductService,
  ProductStatus,
  ProductVariantService,
  ShippingProfileService,
  Store,
  StoreService,
  TransactionBaseService,
  Variant,
} from "@medusajs/medusa";
import PrestashopClientService, {
  PluginOptions,
} from "medusa-source-prestashop/src/services/prestashop-client";
import fs from "fs";
const http = require("https");
const axios = require("axios");

import { EntityManager } from "typeorm";

type InjectedDependencies = {
  productService: ProductService;
  prestashopClientService: PrestashopClientService;
  currencyService: CurrencyService;
  productVariantService: ProductVariantService;
  productCollectionService: ProductCollectionService;
  shippingProfileService: ShippingProfileService;
  storeService: StoreService;
  manager: EntityManager;
  fileService: DefaultFileService;
};

class PrestashopProductService extends TransactionBaseService {
  protected manager_: EntityManager;
  protected transactionManager_: EntityManager;
  protected options_: PluginOptions;
  protected productService_: ProductService;
  protected prestashopClientService_: PrestashopClientService;
  protected currencyService_: CurrencyService;
  protected fileService_: DefaultFileService;
  protected productVariantService_: ProductVariantService;
  protected productCollectionService_: ProductCollectionService;
  protected shippingProfileService_: ShippingProfileService;
  protected storeServices_: StoreService;
  protected currencies: string[];
  protected defaultShippingProfileId: string;

  // downloadFile = (url) =>
  //   axios({ url, responseType: "arraybuffer" }).then((res) => res.data);

  constructor(container: InjectedDependencies, options: PluginOptions) {
    super(container);
    this.manager_ = container.manager;
    this.options_ = options;
    this.productService_ = container.productService;
    this.prestashopClientService_ = container.prestashopClientService;
    this.currencyService_ = container.currencyService;
    this.fileService_ = container.fileService;
    this.productVariantService_ = container.productVariantService;
    this.productCollectionService_ = container.productCollectionService;
    this.shippingProfileService_ = container.shippingProfileService;
    this.storeServices_ = container.storeService;

    this.currencies = [];
    this.defaultShippingProfileId = "";
  }

  async create(productData: any): Promise<void> {
    return this.atomicPhase_(async (manager) => {
      //check if product exists
      const existingProduct: Product = await this.productService_
        .withTransaction(manager)
        .retrieveByExternalId(productData.data.product.id, {
          relations: ["variants", "options", "images"],
        })
        .catch(() => undefined);

      if (existingProduct) {
        // update the product instead
        return this.update(productData, existingProduct);
      } else {
        //check if it's a variant

        // looking up by reference since Prestashop doesn't have SKU property.
        // When is normalized the product is taking reference value and store as SKU.
        // If the product exists this method is not called but the variant is checked if exists in update method so
        // it will update it or create it.

        const existingVariant: Variant = await this.productVariantService_
          .withTransaction(manager)
          .retrieveBySKU(productData.data.product.reference)
          .catch(() => undefined);

        if (existingVariant) {
          return this.updateVariant(productData, existingVariant);
        }
      }

      //retrieve store's currencies

      await this.getCurrencies();

      const normalizedProduct = this.normalizeProduct(productData);
      normalizedProduct.profile_id = await this.getDefaultShippingProfile();

      try {
        if (productData.data.product.associations.categories) {
          await this.setCategory(
            productData.data.product.associations.categories,
            normalizedProduct,
            manager
          );
        }
      } catch (error) {
        console.log(error);
      }

      // retrieve stock

      //out_of_stock 1 = permitted
      //out_of_stock 0 = denied
      //out_of_stock 2 = system behaivour

      let stockValue = await this.prestashopClientService_.retrieveStockValues(
        productData.data.product.associations.stock_availables[0].id
      );

      // creates the options of the product

      if (
        productData.data.product.associations.product_option_values?.length >= 1
      ) {
        for await (const item of productData.data.product.associations
          .product_option_values) {
          let optionValue =
            await this.prestashopClientService_.retrieveOptionValues(item.id);
          let optionData = await this.prestashopClientService_.retrieveOption(
            optionValue.data.product_option_value.id_attribute_group
          );
          if (
            !normalizedProduct.options.some((ele) => {
              return (
                ele.metadata.prestashop_id == optionData.data.product_option.id
              );
            })
          ) {
            normalizedProduct.options.push(
              this.normalizeOption(optionData.data.product_option)
            );
          }
        }
      }

      let productImages = normalizedProduct.images;
      delete normalizedProduct.images;

      //create product
      let product;
      try {
        product = await this.productService_
          .withTransaction(manager)
          .create(normalizedProduct);
      } catch (error) {
        console.log(error);
      }

      if (productData.data.product.associations.combinations?.length >= 1) {
        //insert the configurable product's simple products as variants
        //re-retrieve product with options
        product = await this.productService_
          .withTransaction(manager)
          .retrieve(product.id, {
            relations: ["options"],
          });

        //attached option id to normalized options
        normalizedProduct.options = normalizedProduct.options.map((option) => {
          const productOption = product.options.find(
            (o) => o.title === option.title
          );

          return {
            ...option,
            id: productOption.id,
          };
        });

        // //retrieve simple products as variants
        // const variants = await this.magentoClientService_
        //   .retrieveSimpleProductsAsVariants(productData.extension_attributes?.configurable_product_links);

        for await (const item of productData.data.product.associations
          .combinations) {
          let combinationValues =
            await this.prestashopClientService_.retrieveCombinationValues(
              item.id
            );
          let options = [];
          for await (const optionValueId of combinationValues.data.combination
            .associations.product_option_values) {
            let optionValues =
              await this.prestashopClientService_.retrieveOptionValues(
                optionValueId.id
              );
            normalizedProduct.options.map((element) => {
              if (
                element.metadata.prestashop_id ==
                optionValues.data.product_option_value.id_attribute_group
              ) {
                let option = {
                  option_id: element.id,
                  value: optionValues.data.product_option_value.name,
                  metadata: {
                    prestashop_id: optionValues.data.product_option_value.id,
                  },
                };
                options.push(option);
              }
            });
          }

          for await (const stockAvailabe of productData.data.product
            .associations.stock_availables) {
            if (stockAvailabe.id_product_attribute == item.id) {
              stockValue =
                await this.prestashopClientService_.retrieveStockValues(
                  stockAvailabe.id
                );
            }
          }

          if (stockValue.data.stock_available.out_of_stock == 0) {
            combinationValues.data.combination.allow_backorder = false;
          } else {
            combinationValues.data.combination.allow_backorder = true;
          }

          combinationValues.data.combination.inventory_quantity = parseInt(
            stockValue.data.stock_available.quantity
          );

          const variantData = await this.normalizeVariant(
            combinationValues.data.combination,
            options
          );

          try {
            await this.productVariantService_
              .withTransaction(manager)
              .create(product.id, variantData);
          } catch (error) {
            console.log(error);
          }
        }

        // it's not neccesary because it just download all the images associated to the product, since Medusa doesn't associate an especific image to a variant.

        //   if (v.media_gallery_entries) {
        //     //update products images with variant's images
        //     productImages.push(...v.media_gallery_entries.map((entry) => entry.url));
        //   }
        // }
      } else {
        //insert a default variant for a simple product
        if (stockValue.data.stock_available.out_of_stock == 0) {
          productData.data.product.allow_backorder = false;
        } else {
          productData.data.product.allow_backorder = true;
        }

        productData.data.product.inventory_quantity = parseInt(
          stockValue.data.stock_available.quantity
        );

        const variantData = this.normalizeVariant(productData.data.product, []);

        variantData.title = "Default";

        try {
          await this.productVariantService_
            .withTransaction(manager)
            .create(product.id, variantData);
        } catch (error) {
          console.log(error);
        }
      }

      productImages = [...new Set(productImages)];

      let productImagesFileService = [];

      if (productData.data.product.images != undefined) {
        for await (const element of productImages) {
          // const res = await this.downloadFile(element);
          const res = await this.prestashopClientService_.downloadFile(element);

          await fs.writeFileSync("./uploads/tempImage.jpg", res);

          let response = await this.fileService_.upload({
            fieldname: "files",
            originalname: productData.data.product.link_rewrite + ".jpeg",
            encoding: "7bit",
            mimetype: "image/jpeg",
            destination: "uploads/",
            filename: productData.data.product.link_rewrite + ".jpeg",
            path: "./uploads/tempImage.jpg",
            size: 52370,
          });

          productImagesFileService.push(response.url);
        }

        await this.productService_.withTransaction(manager).update(product.id, {
          images: productImagesFileService,
        });
      }
    });
  }

  async update(productData: any, existingProduct: Product): Promise<void> {
    return this.atomicPhase_(async (manager) => {
      //retrieve store's currencies

      const optionsPrestashop = [];
      const optionsValuePrestashop = [];

      await this.getCurrencies();

      const normalizedProduct = this.normalizeProduct(productData);
      let productOptions = existingProduct.options;

      if (productData.data.product.associations.categories) {
        await this.setCategory(
          productData.data.product.associations.categories,
          normalizedProduct,
          manager
        );
      }

      let stockValue = await this.prestashopClientService_.retrieveStockValues(
        productData.data.product.associations.stock_availables[0].id
      );

      productOptions = (
        await this.productService_
          .withTransaction(manager)
          .retrieveByExternalId(productData.data.product.id, {
            relations: ["options", "options.values"],
          })
      ).options;

      // var newOptions = [];

      // has options
      if (
        productData.data.product.associations.product_option_values?.length >= 1
      ) {
        // retrieve options
        for await (const item of productData.data.product.associations
          .product_option_values) {
          // productData.data.product.associations.product_option_values.map(async (item, index)=>{

          let optionValue =
            await this.prestashopClientService_.retrieveOptionValues(item.id);

          optionsValuePrestashop.push(optionValue.data);

          const existingOption = productOptions.find(
            (o) =>
              o.metadata.prestashop_id ==
              optionValue.data.product_option_value.id_attribute_group
          );

          let option = await this.prestashopClientService_.retrieveOption(
            optionValue.data.product_option_value.id_attribute_group
          );

          optionsPrestashop.push(option.data);

          if (!existingOption) {
            //add option
            await this.productService_
              .withTransaction(manager)
              .addOption(existingProduct.id, option.data.product_option.name);
          }

          //update option and its values
          const normalizedOption = this.normalizeOption(
            option.data.product_option
          );
          delete normalizedOption.values;

          await this.productService_
            .withTransaction(manager)
            .updateOption(
              existingProduct.id,
              existingOption.id,
              normalizedOption
            );
        }

        //check if there are options that should be deleted
        const optionsToDelete = productOptions.filter(
          (o) =>
            !optionsPrestashop.find((prestashop_option) => {
              return (
                prestashop_option.product_option.id == o.metadata.prestashop_id
              );
            })
        );

        optionsToDelete.forEach(async (option) => {
          await this.productService_
            .withTransaction(manager)
            .deleteOption(existingProduct.id, option.id);
        });

        //re-retrieve product options
        productOptions = (
          await this.productService_
            .withTransaction(manager)
            .retrieveByExternalId(productData.data.product.id, {
              relations: ["options", "options.values"],
            })
        ).options;
      }

      // it would be neccesary that ImageRepo will store metadata image_id of prestashop in order to check if the image is already uploaded.

      // let productImages = existingProduct.images.map((image) => image.url);
      let productImages = normalizedProduct.images;
      delete normalizedProduct.images;

      if (productData.data.product.associations.combinations?.length >= 1) {
        //attach values to the options

        productOptions = productOptions.map((productOption) => {
          const productDataOption = optionsValuePrestashop.find(
            (o) =>
              productOption.metadata.prestashop_id ==
              o.product_option_value.id_attribute_group
          );

          if (productDataOption) {
            productOption.values =
              this.normalizeOptionValues(productDataOption).values;
          }

          return productOption;
        });

        // delete combinations

        existingProduct.variants.map(async (variant, key) => {
          let existsVariant =
            await this.prestashopClientService_.retrieveCombinationValues(
              variant.metadata.prestashop_id
            );
          if (existsVariant === null) {
            try {
              await this.productVariantService_
                .withTransaction(manager)
                .delete(variant.id);
              delete existingProduct.variants[key];
            } catch (error) {
              console.log(error);
            }
          }
        });

        // //retrieve simple products as variants
        // const variants = await this.magentoClientService_
        //   .retrieveSimpleProductsAsVariants(productData.extension_attributes?.configurable_product_links);

        for await (const item of productData.data.product.associations
          .combinations) {
          const existingVariant = existingProduct.variants.find(
            async (variant) => {
              return variant.metadata.prestashop_id + "" === item.id;
            }
          );

          if (existingVariant != null) {
            let combinationValues =
              await this.prestashopClientService_.retrieveCombinationValues(
                item.id
              );

            let options = [];
            for await (const optionValueId of combinationValues.data.combination
              .associations.product_option_values) {
              let optionValues =
                await this.prestashopClientService_.retrieveOptionValues(
                  optionValueId.id
                );
              productOptions.map((element) => {
                if (
                  element.metadata.prestashop_id ==
                  optionValues.data.product_option_value.id_attribute_group
                ) {
                  let option = {
                    option_id: element.id,
                    value: optionValues.data.product_option_value.name,
                    metadata: {
                      prestashop_id: optionValues.data.product_option_value.id,
                    },
                  };
                  options.push(option);
                }
              });
            }

            for await (const stockAvailabe of productData.data.product
              .associations.stock_availables) {
              if (stockAvailabe.id_product_attribute == item.id) {
                stockValue =
                  await this.prestashopClientService_.retrieveStockValues(
                    stockAvailabe.id
                  );
              }
            }

            combinationValues.data.combination.inventory_quantity = parseInt(
              stockValue.data.stock_available.quantity
            );

            if (stockValue.data.stock_available.out_of_stock == 0) {
              combinationValues.data.combination.allow_backorder = false;
            } else {
              combinationValues.data.combination.allow_backorder = true;
            }

            const variantData = await this.normalizeVariant(
              combinationValues.data.combination,
              options,
              productData.data.product.price
            );

            variantData.options.forEach((element, key) => {
              if (Object.is(variantData.options.length - 1, key)) {
                variantData.title = element.value;
              } else {
                variantData.title = element.value + " - ";
              }
            });

            try {
              await this.productVariantService_
                .withTransaction(manager)
                .update(existingVariant.id, variantData);
            } catch (error) {
              console.log(error);
            }
          } else {
            let combinationValues =
              await this.prestashopClientService_.retrieveCombinationValues(
                item.id
              );

            let options = [];
            for await (const optionValueId of combinationValues.data.combination
              .associations.product_option_values) {
              let optionValues =
                await this.prestashopClientService_.retrieveOptionValues(
                  optionValueId.id
                );

              productOptions.map((element) => {
                if (
                  element.metadata.prestashop_id ==
                  optionValues.data.product_option_value.id_attribute_group
                ) {
                  let option = {
                    option_id: element.id,
                    value: optionValues.data.product_option_value.name,
                    metadata: {
                      prestashop_id: optionValues.data.product_option_value.id,
                    },
                  };
                  options.push(option);
                }
              });
            }

            for await (const stockAvailabe of productData.data.product
              .associations.stock_availables) {
              if (stockAvailabe.id_product_attribute == item.id) {
                stockValue =
                  await this.prestashopClientService_.retrieveStockValues(
                    stockAvailabe.id
                  );
              }
            }

            if (stockValue.data.stock_available.out_of_stock == 0) {
              combinationValues.data.combination.allow_backorder = false;
            } else {
              combinationValues.data.combination.allow_backorder = true;
            }

            combinationValues.data.combination.inventory_quantity = parseInt(
              stockValue.data.stock_available.quantity
            );

            const variantData = await this.normalizeVariant(
              combinationValues.data.combination,
              options,
              productData.data.product.price
            );

            variantData.options.forEach((element, key) => {
              if (Object.is(variantData.options.length - 1, key)) {
                variantData.title = element.value;
              } else {
                variantData.title = element.value + " - ";
              }
            });

            try {
              await this.productVariantService_
                .withTransaction(manager)
                .create(existingProduct.id, variantData);
            } catch (error) {
              console.log(error);
            }
          }
        }

        // it's not neccesary because it just download all the images associated to the product, since Medusa doesn't associate an especific image to a variant.

        //   if (v.media_gallery_entries) {
        //     //update products images with variant's images
        //     productImages.push(...v.media_gallery_entries.map((entry) => entry.url));
        //   }
        // }
      } else {
        //insert a default variant for a simple product
        if (stockValue.data.stock_available.out_of_stock == 0) {
          productData.data.product.allow_backorder = false;
        } else {
          productData.data.product.allow_backorder = true;
        }

        productData.data.product.inventory_quantity = parseInt(
          stockValue.data.stock_available.quantity
        );

        const variantData = this.normalizeVariant(productData.data.product, []);

        variantData.title = "Default";

        // checks if there is just one variant so it's a simple product.
        // if it's equal 1 it means that is the same variant so it will update it
        // otherwise it will create it.

        if (existingProduct.variants.length == 1) {
          try {
            await this.productVariantService_
              .withTransaction(manager)
              .update(existingProduct.variants[0].id, variantData);
          } catch (error) {
            console.log(error);
          }
        } else {
          try {
            await this.productVariantService_
              .withTransaction(manager)
              .create(existingProduct.id, variantData);
          } catch (error) {
            console.log(error);
          }
        }
      }

      productImages = [...new Set(productImages)];

      let productImagesFileService = [];

      if (productData.data.product.images != undefined) {
        for await (const element of productImages) {
          // const res = await this.downloadFile(element);
          const res = await this.prestashopClientService_.downloadFile(element);

          await fs.writeFileSync("./uploads/tempImage.jpg", res);

          let response = await this.fileService_.upload({
            fieldname: "files",
            originalname: productData.data.product.link_rewrite + ".jpeg",
            encoding: "7bit",
            mimetype: "image/jpeg",
            destination: "uploads/",
            filename: productData.data.product.link_rewrite + ".jpeg",
            path: "./uploads/tempImage.jpg",
            size: 52370,
          });

          productImagesFileService.push(response.url);
        }

        await this.productService_
          .withTransaction(manager)
          .update(existingProduct.id, {
            images: productImagesFileService,
          });
      }

      //update product
      delete normalizedProduct.options;
      delete normalizedProduct.images;

      const update = {};

      for (const key of Object.keys(normalizedProduct)) {
        if (normalizedProduct[key] !== existingProduct[key]) {
          update[key] = normalizedProduct[key];
        }
      }

      // normalizedProduct.images = productImages;

      if (Object.values(update).length) {
        await this.productService_
          .withTransaction(manager)
          .update(existingProduct.id, update);
      }
    });
  }

  async updateVariant(
    productData: any,
    existingVariant: Variant
  ): Promise<void> {
    return this.atomicPhase_(async (manager: EntityManager) => {
      //retrieve store's currencies
      await this.getCurrencies();

      const variantData = await this.normalizeVariant(
        productData.data.product,
        []
      );
      delete variantData.options;
      delete variantData.prestashop_id;

      const update = {};

      for (const key of Object.keys(variantData)) {
        if (variantData[key] !== existingVariant[key]) {
          update[key] = variantData[key];
        }
      }

      if (Object.values(update).length) {
        await this.productVariantService_
          .withTransaction(manager)
          .update(existingVariant.id, variantData);
      }
    });
  }

  async getCurrencies() {
    if (this.currencies.length) {
      return;
    }

    const defaultStore: Store = await this.storeServices_.retrieve({
      relations: ["currencies", "default_currency"],
    });
    this.currencies = [];

    this.currencies.push(
      ...(defaultStore.currencies?.map((currency) => currency.code) || [])
    );
    this.currencies.push(defaultStore.default_currency?.code);
  }

  async getDefaultShippingProfile(): Promise<string> {
    if (!this.defaultShippingProfileId.length) {
      this.defaultShippingProfileId =
        await this.shippingProfileService_.retrieveDefault();
    }

    return this.defaultShippingProfileId;
  }

  async setCategory(
    categories: Record<string, any>[],
    product: Record<string, any>,
    manager: EntityManager
  ) {
    //Magento supports multiple categories for a product
    //since Medusa supports only one collection for a product, we'll
    //use the category with the highest position

    // categories.sort((a, b) => {
    //   if (a.position > b.position) {
    //     return 1;
    //   }

    //   return a.position < b.position ? -1 : 0;
    // })

    //retrieve Medusa collection using magento ID
    const [_, count] = await this.productCollectionService_
      .withTransaction(manager)
      .listAndCount();

    const existingCollections = await this.productCollectionService_
      .withTransaction(manager)
      .list(
        {},
        {
          skip: 0,
          take: count,
        }
      );

    if (existingCollections.length) {
      product.collection_id = existingCollections.find((collection) => {
        for (let category of categories) {
          if (collection.metadata.prestashop_id == category.id) {
            return true;
          }
        }

        return false;
      })?.id;
    }

    return product;
  }

  normalizeProduct(product: Record<string, any>): any {
    product.data.product.meta_keywords = (
      product.data.product.meta_keywords || ""
    ).split(",");
    product.data.product.meta_keywords =
      product.data.product.meta_keywords.filter((element) => {
        if (element === "" || element === " ") {
          return false;
        } else {
          return true;
        }
      });

    return {
      title: product.data.product.name,
      // profile_id: "sp_01GKH5C2YCXY22RA9NP28DFR6D",
      handle: product.data.product.link_rewrite,
      is_giftcard: false,
      discountable: true,
      description: product.data.product.description,
      subtitle: product.data.product.description_short,
      weight: parseFloat(product.data.product.weight),
      height: parseFloat(product.data.product.height),
      lenght: parseFloat(product.data.product.depth),
      width: parseFloat(product.data.product.width),
      // type: {
      //   value: product.type_id
      // },
      external_id: product.data.product.id,
      status:
        product.data.product.active == 1
          ? ProductStatus.PUBLISHED
          : ProductStatus.DRAFT,
      images: product.data.product.images?.map((img) => img.href) || [],

      // images:
      // product.data.product.images?.map(
      //   (img) => img.href + "/&ws_key=FZQX58LATQZGXAEVUTU4PMSNVT19QASS"
      // ) || [],

      // // thumbnail: product.media_gallery_entries?.find((img) => img.types.includes('thumbnail'))?.url,
      options: [],
      // // collection_id: product.data.product.associations.categories[0].id
      collection_id: null,
      // tags: product.data.product.meta_keywords.map((value) => ({
      //   value: value
      // })),
      metadata: {
        prestashop_id: product.data.product.id,
        reference: product.data.product.reference,
        manufacturer_name: product.data.product.manufacturer_name,
        date_upd: product.data.product.date_upd,
        meta_keywords: product.data.product.meta_keywords,
      },
    };
  }

  normalizeVariant(
    variant: Record<string, any>,
    options?: Record<string, any>[],
    itemPrice?: any
  ): Record<string, any> {
    let total = parseFloat(itemPrice) + parseFloat(variant.price);
    return {
      title: variant.id,
      prices: this.currencies.map((currency) => ({
        amount:
          itemPrice != undefined
            ? this.parsePrice(total)
            : this.parsePrice(variant.price),
        currency_code: currency,
      })),
      sku: variant.reference === "" ? null : variant.reference,
      barcode: variant.ean13 === "" ? null : variant.ean13,
      ean: variant.ean13 === "" ? null : variant.ean13,
      upc: variant.upc === "" ? null : variant.upc,
      inventory_quantity: variant.inventory_quantity,
      allow_backorder: variant.allow_backorder,
      // dependes_on_stock is deprecated in Prestashop  https://devdocs.prestashop-project.org/1.7/modules/core-updates/1.7.8/
      // The way it works is if the quantity of inventory is greater than 1, manage inventory is enabled
      manage_inventory: variant.inventory_quantity > 0 ? true : false,
      weight: ~~variant.weight || 0,
      options: options,
      metadata: {
        prestashop_id: variant.id,
        isbn: variant.isbn,
        supplier_reference: variant.supplier_reference,
        location: variant.location,
      },
    };
  }

  normalizeOption(option: Record<string, any>): any {
    return {
      title: option.name,
      values: option.associations.product_option_values.map((value) => ({
        value: value.id,
        metadata: {
          prestashop_value: value.id,
        },
      })),
      metadata: {
        prestashop_id: option.id,
      },
    };
  }

  normalizeOptionValues(option: Record<string, any>): any {
    return {
      values: {
        value: option.product_option_value.name,
        metadata: {
          prestashop_value: option.product_option_value.id,
        },
      },
    };
  }

  parsePrice(price: any): number {
    return parseInt((parseFloat(Number(price).toFixed(2)) * 100).toString());
  }

  removeHtmlTags(str: string): string {
    if (str === null || str === "") {
      return "";
    }

    str = str.toString();

    // Regular expression to identify HTML tags in
    // the input string. Replacing the identified
    // HTML tag with a null string.
    return str.replace(/(<([^>]+)>)/gi, "");
  }
}

export default PrestashopProductService;
