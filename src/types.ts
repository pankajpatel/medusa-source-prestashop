export type Stock = {
  id: number;
  id_product: string;
  id_product_attribute: string;
  id_shop: string;
  id_shop_group: string;
  quantity: string;
  depends_on_stock: string;
  out_of_stock: string;
  location: string;
};

export interface PluginOptions {
  prestashop_url: string;
  consumer_key: string;
  generateNewHandles?: boolean;
  additionalParams?: Record<string, any>;
}

export type SearchCriteria = {
  currentPage: string;
  filterGroups?: Array<
    Array<{ field: string; value: string; condition_type: string }>
  >;
  storeId: string | number;
  currencyCode: string;
};
