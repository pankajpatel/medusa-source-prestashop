import { stringify } from "qs";
import urlExists from "url-exists-deep";
import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
import axios, { AxiosInstance, AxiosResponse } from "axios";

import { EntityManager } from "typeorm";
import { Logger } from "@medusajs/medusa/dist/types/global";
import { MedusaError } from "medusa-core-utils";
import { TransactionBaseService } from "@medusajs/medusa";
// import addOAuthInterceptor from 'axios-oauth-1.0a';

type InjectedDependencies = {
  manager: EntityManager;
  logger: Logger;
};

class PrestashopClientService extends TransactionBaseService {
  protected manager_: EntityManager;
  protected transactionManager_: EntityManager;
  protected logger_: Logger;
  protected apiBaseUrl_: string;

  protected options_: PluginOptions;
  protected client_: AxiosInstance;
  protected defaultStoreId_: string;
  protected defaultCurrencyCode_: string;
  protected defaultImagePrefix_: string;

  constructor(container: InjectedDependencies, options) {
    super(container);
    this.manager_ = container.manager;
    this.logger_ = container.logger;
    this.options_ = options;
    this.apiBaseUrl_ = `${options.prestashop_url}`;

    // https://farmaciapaseo51.com/api/products/1360/&ws_key=FZQX58LATQZGXAEVUTU4PMSNVT19QADD&output_format=JSON

    this.client_ = axios.create({
      headers: {
        Accept: "application/json",
      },
    });

    // addOAuthInterceptor(this.client_, {
    //   algorithm: 'HMAC-SHA256',
    //   key: options.consumer_key,
    //   secret: options.consumer_secret,
    //   token: options.access_token,
    //   tokenSecret: options.access_token_secret
    // });

    this.client_.interceptors.request.use(null, (error) => {
      console.log(error);
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        error.response?.data?.message ||
          error.request?.data?.message ||
          error.message ||
          "An error occurred while sending the request."
      );
    });

    this.client_.interceptors.response.use(null, (error) => {
      console.log(error);
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        error.response?.data?.message ||
          error.request?.data?.message ||
          error.message ||
          "An error occurred while sending the request."
      );
    });

    this.defaultImagePrefix_ = options.image_prefix;
  }

  get endUrl() {
    return `/&${stringify(this.getPSReqParameters())}`;
  }

  get endUrlXML() {
    return `/&${stringify(this.getPSReqParameters("xml"))}`;
  }

  getPSReqParameters(format: "json" | "xml" = "json") {
    const params = {
      ...(this.options_.additionalParams || {}),
      ws_key: this.options_.consumer_key,
    };

    format === "json" && (params.output_format = format.toUpperCase());
    return params;
  }

  async retrieveProducts(): Promise<Record<string, any>[]> {
    return this.sendRequest(`/products/` + this.endUrl);
  }

  async downloadFile(url2): Promise<any> {
    let url = url2 + this.endUrlXML;
    return axios({ url, responseType: "arraybuffer" }).then((res) => res.data);
  }

  // downloadFile = (url) =>
  // axios({ url, responseType: "arraybuffer" }).then((res) => res.data);

  async retrieveImages(productId?: string): Promise<Record<string, any>[]> {
    try {
      const imagesId = await this.sendRequest(
        `/images/products/` + productId + this.endUrlXML
      );
      const options = {
        ignoreAttributes: false,
        attributeNamePrefix: "",
        removeNSPrefix: true,
      };
      const parser = new XMLParser(options);
      let imagesTemp = [];

      if (!imagesId?.data) return imagesTemp;

      let images = await parser.parse(imagesId.data);

      if (images.prestashop.image.declination.length) {
        images.prestashop.image.declination.forEach((element) => {
          imagesTemp.push(element);
        });
      } else {
        imagesTemp.push(images.prestashop.image.declination);
      }
      return imagesTemp;
    } catch (error) {
      console.log(error);
    }
  }

  async retrieveProduct(productId?: string): Promise<Record<string, any>[]> {
    return this.sendRequest(`/products/` + productId + this.endUrl);
  }

  async retrieveProductImages(
    items: Record<string, any>[]
  ): Promise<Record<string, any>[]> {
    if (!this.defaultStoreId_ || !this.defaultCurrencyCode_) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Default Store ID and Default Currency Code must be set first."
      );
    }

    const { data } = await this.sendRequest(
      `/products-render-info?${this.formatSearchCriteriaQuery({
        currentPage: 1,
        filterGroups: [
          [
            {
              field: "entity_id",
              value: items.map((item) => item.id).join(","),
              condition_type: "in",
            },
          ],
        ],
        storeId: this.defaultStoreId_,
        currencyCode: this.defaultCurrencyCode_,
      })}`
    );

    return items.map((item) => {
      const itemData = data.items.find((i) => i.id == item.id);
      if (itemData) {
        item.images = itemData.images || [];
      }

      return item;
    });
  }

  async retrieveDefaultConfigs() {
    if (this.defaultImagePrefix_) {
      return;
    }

    const { data } = await this.sendRequest(`/store/storeConfigs`);

    const defaultStore = data.length
      ? data.find((store) => store.code === "default")
      : data;

    if (!this.defaultImagePrefix_) {
      this.defaultImagePrefix_ = `${defaultStore.base_media_url}catalog/product`;
    }
  }

  // async retrieveOptionValues(title: string): Promise<Record<string, any>[]> {
  //   return this.sendRequest(`/products/attributes/${title}`).then(
  //     ({ data }) => {
  //       return data.options.filter((values) => values.value.length > 0);
  //     }
  //   );
  // }

  // async retrieveOptions(): Promise<Record<string, any>[]> {
  //   const searchCriteria: SearchCriteria = {
  //     currentPage: 1,
  //   };

  //   return this.sendRequest(
  //     `/products/attributes?${this.formatSearchCriteriaQuery(searchCriteria)}`
  //   ).then(({ data }) => {
  //     return data.items;
  //   });
  // }

  async retrieveInventoryData(sku: string): Promise<AxiosResponse<any>> {
    return this.sendRequest(`/stockItems/${sku}`);
  }

  async retrieveSimpleProductsAsVariants(
    productIds: string[]
  ): Promise<Record<string, any>[]> {
    return this.retrieveProducts().then(async (products) => {
      return await Promise.all(
        products.map(async (variant) => {
          //get stock item of that variant
          const { data } = await this.retrieveInventoryData(variant.sku);

          return {
            ...variant,
            stockData: data,
          };
        })
      );
    });
  }
  //https://farmaciapaseo51.com/api/products/1360/&ws_key=FZQX58LATQZGXAEVUTU4PMSNVT19QADD&output_format=JSON
  async retrieveCategories(
    lastUpdatedTime?: string
  ): Promise<AxiosResponse<any>> {
    return this.sendRequest(`/categories/` + this.endUrl);
  }

  async retrieveOptionsDefaults(): Promise<AxiosResponse<any>> {
    return this.sendRequest(`/product_options/` + this.endUrl);
  }

  async retrieveOptionsValues(): Promise<AxiosResponse<any>> {
    return this.sendRequest(`/product_option_values/` + this.endUrl);
  }

  async retrieveOptionValues(optionId?: string): Promise<AxiosResponse<any>> {
    return this.sendRequest(`/product_option_values/` + optionId + this.endUrl);
  }

  async retrieveStockValues(stockId?: string): Promise<AxiosResponse<any>> {
    return this.sendRequest(`/stock_availables/` + stockId + this.endUrl);
  }

  async retrieveCombinationValues(
    combinationId?: string
  ): Promise<AxiosResponse<any>> {
    return this.sendRequest(`/combinations/` + combinationId + this.endUrl);
  }

  async retrieveOption(optionId?: string): Promise<AxiosResponse<any>> {
    return this.sendRequest(`/product_options/` + optionId + this.endUrl);
  }

  async retrieveCategory(categoryID?: string): Promise<AxiosResponse<any>> {
    return this.sendRequest(`/categories/` + categoryID + this.endUrl);
  }

  async sendRequest(
    path: string,
    method: string = "GET",
    data?: Record<string, any>
  ): Promise<AxiosResponse<any>> {
    const url = `${this.apiBaseUrl_}${path}`;
    const exists = await urlExists(url);
    if (exists) {
      return this.client_.request({
        url: `${this.apiBaseUrl_}${path}`,
        method,
        data,
      });
    } else {
      return null;
    }
  }

  formatSearchCriteriaQuery(searchCriteria: SearchCriteria): string {
    let query = `searchCriteria[currentPage]=${searchCriteria.currentPage}`;

    if (searchCriteria.filterGroups?.length) {
      searchCriteria.filterGroups.map((filterGroup, index) => {
        filterGroup.map((filter, filterIndex) => {
          query += `&searchCriteria[filterGroups][${index}][filters][${filterIndex}][field]=${filter.field}&searchCriteria[filterGroups][${index}][filters][${filterIndex}][value]=${filter.value}&searchCriteria[filterGroups][${index}][filters][${filterIndex}][condition_type]=${filter.condition_type}`;
        });
      });
    }

    if (searchCriteria.storeId) {
      query += `&storeId=${searchCriteria.storeId}`;
    }

    if (searchCriteria.currencyCode) {
      query += `&currencyCode=${searchCriteria.currencyCode}`;
    }

    return query;
  }
}

export default PrestashopClientService;
