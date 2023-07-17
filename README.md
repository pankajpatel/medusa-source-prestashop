<p align="center">
  <a href="https://www.medusa-commerce.com">
    <img alt="Medusa" src="https://i.imgur.com/USubGVY.png" width="100" />
  </a>
</p>
<h1 align="center">
  Prestashop Source Plugin for Medusa
</h1>
<p align="center">
  A Medusa plugin that imports categories and products from Prestashop into Medusa.
</p>

## Description

This plugin imports Prestashop categories and products into Medusa. It creates categories and products that don't exist and updates those that have been imported previously.

### Limitations

## Prerequisites

### Medusa Setup

You must have a [Medusa server installed](https://docs.medusajs.com/quickstart/quick-start) before installing this plugin.

Furthermore, the Medusa server should have [PostgreSQL](https://docs.medusajs.com/tutorial/set-up-your-development-environment#postgresql), [Redis](https://docs.medusajs.com/tutorial/set-up-your-development-environment#redis) and [File Service](https://docs.medusajs.com/quickstart/quick-start#file-service-plugin) installed and configured on your Medusa server.

### Prestashop Setup

Go to the PrestaShop back office, open the “Web service” page under the “Advanced Parameters” menu, and then choose “Yes” for the “Enable PrestaShop Webservice” option.

Generate a key and copy it as you'll need them for the plugin's options.

You need to give at least the integration access to the following resources:

- products
- product_options
- product_option_values
- combinations
- categories
- stock_availables
- images

We recommend enabling all the resources.

## Installing Plugin

To install the plugin run the following command on your Medusa server:

```bash
npm install medusa-source-prestashop
```

## Plugin Configurations

Add the plugin and its options into the `plugins` array in `medusa-config.js`:

```js
const plugins = [
  //...
  {
    resolve: `medusa-source-prestashop`,
    //if your plugin has configurations
    options: {
      prestashop_url: '<YOUR_PRESTASHOP_URL>', // example 'https://prestashopstore.com/api',
      consumer_key: '<YOUR_CONSUMER_KEY>' // example 'FDSFJKLJFASDKLFJAJLKJFDS'
      additionalParams: {}
      generateNewHandles: boolean
    },
  },
];
```

### Options

| Name                 | Description                                                                        | Required | Default Value |
| -------------------- | ---------------------------------------------------------------------------------- | -------- | ------------- |
| `prestashop_url`     | The URL of your Medusa server. It should end with a /api.                          | true     |               |
| `consumer_key`       | The Consumer Key of the integration.                                               | true     |               |
| `generateNewHandles` | Should the importer generate new handles or use link_rewrite in prestashop product | false    | `false`       |
| `additionalParams`   | Additional parameters to send when making Prestashop webservice request            | false    | `undefined`   |

## Use the Plugin

### Server Startup

To use the plugin, just start the Medusa server:

```bash
npm start
```

The import process will run in the background of the server. Based on how many products you have, it can take some time the first time running it.

### As a Batch Job

You can trigger the import by creating a new batch job using the Create Batch Job API endpoint. You can pass the following in the payload:

```json
{
  "type": "import-prestashop",
  "context": {},
  "dry_run": false
}
```

This will trigger the import process.
