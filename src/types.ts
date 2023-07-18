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

export type Category = {
  id: number;
  id_parent: string;
  level_depth: string;
  nb_products_recursive: string;
  active: string;
  id_shop_default: string;
  is_root_category: string;
  position: string;
  date_add: string;
  date_upd: string;
  name: string;
  link_rewrite: string;
  description: string;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
  associations: {
    categories: Array<{ id: string }>;
  };
};

export type CategoriesResponse = { categories: Array<Category> };

export type StockAvailable = {
  id: number;
  id_product: string;
  id_product_attribute: string;
  id_shop: string;
  id_shop_group: string;
  quantity: string | number;
  depends_on_stock: string;
  out_of_stock: string;
  location: string;
};

export type StockAvailablesResponse = {
  stock_availables: Array<StockAvailable>;
};

export type ProductOptionValue = {
  id: number;
  id_attribute_group: string;
  color?: string;
  position?: string;
  name: string;
};

export type ProductOptionValuesResponse = {
  product_option_values: Array<ProductOptionValue>;
};

export type ProductOption = {
  id: number;
  is_color_group: string;
  group_type: string;
  position: string;
  name: string;
  public_name: string;
  product_option_values: Array<ProductOptionValue>;
};

export type ProductOptionsResponse = {
  product_options: Array<ProductOption>;
};

export type Product = {
  id: number;
  id_manufacturer: string;
  id_supplier: string;
  id_category_default: string;
  new: null | boolean;
  cache_default_attribute: string;
  id_default_image: boolean;
  id_default_combination: number;
  id_tax_rules_group: string;
  position_in_category: string;
  manufacturer_name: boolean;
  quantity: string;
  type: string;
  id_shop_default: string;
  reference: string;
  supplier_reference: string;
  location: string;
  width: string;
  height: string;
  depth: string;
  weight: string;
  quantity_discount: string;
  ean13: string;
  isbn: string;
  upc: string;
  mpn: string;
  cache_is_pack: string;
  cache_has_attachments: string;
  is_virtual: string;
  state: string;
  additional_delivery_times: string;
  delivery_in_stock: string;
  delivery_out_stock: string;
  product_type: string;
  on_sale: string;
  online_only: string;
  ecotax: string;
  minimal_quantity: string;
  low_stock_threshold: null;
  low_stock_alert: string;
  price: string;
  wholesale_price: string;
  unity: string;
  unit_price_ratio: string;
  additional_shipping_cost: string;
  customizable: string;
  text_fields: string;
  uploadable_files: string;
  active: string;
  redirect_type: string;
  id_type_redirected: string;
  available_for_order: string;
  available_date: string;
  show_condition: string;
  condition: string;
  show_price: string;
  indexed: string;
  visibility: string;
  advanced_stock_management: string;
  date_add: string;
  date_upd: string;
  pack_stock_type: string;
  meta_description: string;
  meta_keywords: string;
  meta_title: string;
  link_rewrite: string;
  name: string;
  description: string;
  description_short: string;
  available_now: string;
  available_later: string;
  associations: {
    categories: Array<{
      id: string;
    }>;
    stock_availables: Array<{
      id: string;
      id_product_attribute: string;
    }>;
  };
  images?: any;
};

export type ProductsResponse = {
  products: Array<Product>;
};
