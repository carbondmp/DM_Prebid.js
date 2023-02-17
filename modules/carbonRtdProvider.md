# Carbon Real-Time Data Submodule

## Overview

    Module Name: Carbon Rtd Provider
    Module Type: Rtd Provider
    Maintainer: rstevens@magnite.com

## Description

The Carbon RTD module appends contextual segments and user custom segment data to the bidding object.

## Usage

### Build
```
gulp build --modules=carbonRtdProvider
```

### Implementation
```
pbjs.setConfig({
  realTimeData: {
    auctionDelay: 80,
    dataProviders: [
      {
        name: 'carbon',
        waitForIt: true,
        params: {
          parentId: '' //Contact Magnite for a unique ID
        }
      }
    ]
  }
});
```