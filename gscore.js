(() => {
  "use strict";

  /**
   * Application-wide static configuration.
   * @type {{
   *   SHEETS: {MONEY: string, CAPITAL: string, PROFIT: string},
   *   DATE_FORMAT: string,
   *   DISPLAY_DATE_FORMAT: string,
   *   CURRENCY_SYMBOL: string,
   *   DECIMAL_PLACES: number,
   *   THOUSANDS_SEPARATOR: string,
   *   DATA_SOURCE_URL: string,
   *   PERIODS: Record<string, {name: string, getDates: () => {startDate: Date, endDate: Date}}>
   * }}
   */
  const CONFIG = {
    SHEETS: {
      MONEY: "Деньги",
      CAPITAL: "Капитал",
      PROFIT: "Прибыль"
    },
    DATE_FORMAT: "dd.MM.yyyy",
    DISPLAY_DATE_FORMAT: "DD.MM.YYYY",
    CURRENCY_SYMBOL: "₽",
    DECIMAL_PLACES: 2,
    THOUSANDS_SEPARATOR: " ",
    DATA_SOURCE_URL: "https://disk.yandex.ru/i/ZJVZH2zabEKqpg",
    PERIODS: {
      currentMonth: {
        name: "Текущий месяц",
        getDates: () => {
          const now = new Date();
          return {
            startDate: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
            endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
          };
        }
      },
      lastMonth: {
        name: "Прошлый месяц",
        getDates: () => {
          const now = new Date();
          return {
            startDate: new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0),
            endDate: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
          };
        }
      },
      currentQuarter: {
        name: "Текущий квартал",
        getDates: () => {
          const now = new Date();
          const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
          return {
            startDate: new Date(now.getFullYear(), quarterStartMonth, 1, 0, 0, 0, 0),
            endDate: new Date(now.getFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999)
          };
        }
      },
      currentYear: {
        name: "Текущий год",
        getDates: () => {
          const now = new Date();
          return {
            startDate: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
            endDate: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
          };
        }
      }
    }
  };

  const STORAGE_KEYS = {
    DATA_SOURCE_URL: "finance-dashboard-source-url"
  };

  const workbookLoaderState = {
    promise: null,
    status: "idle",
    sourceUrl: null,
    downloadUrl: null,
    loadedAt: null,
    error: null
  };

  const OPERATOR_HANDLERS = {
    eq: (left, right) => left === right,
    neq: (left, right) => left !== right,
    gt: (left, right) => left > right,
    gte: (left, right) => left >= right,
    lt: (left, right) => left < right,
    lte: (left, right) => left <= right,
    includes: (left, right) => String(left).toLowerCase().includes(String(right).toLowerCase()),
    in: (left, right) => Array.isArray(right) && right.includes(left),
    exists: (left) => left !== null && left !== "",
    empty: (left) => left === null || left === ""
  };

  /**
   * Logs debug messages in a consistent format.
   * @param {string} message
   * @param {*} [payload]
   */
  function logDebug(message, payload) {
    if (typeof payload === "undefined") {
      console.debug("[GSCore][debug]", message);
      return;
    }

    console.debug("[GSCore][debug]", message, payload);
  }

  /**
   * Logs informational messages in a consistent format.
   * @param {string} message
   * @param {*} [payload]
   */
  function logInfo(message, payload) {
    if (typeof payload === "undefined") {
      console.info("[GSCore][info]", message);
      return;
    }

    console.info("[GSCore][info]", message, payload);
  }

  /**
   * Logs error messages in a consistent format.
   * @param {string} message
   * @param {*} [payload]
   */
  function logError(message, payload) {
    if (typeof payload === "undefined") {
      console.error("[GSCore][error]", message);
      return;
    }

    console.error("[GSCore][error]", message, payload);
  }

  /**
   * Builds a success response contract.
   * @param {*} data
   * @returns {{status: 'success', data: *, error: null}}
   */
  function createSuccessResponse(data) {
    return {
      status: "success",
      data,
      error: null
    };
  }

  /**
   * Builds an error response contract.
   * @param {string} message
   * @returns {{status: 'error', data: null, error: string}}
   */
  function createErrorResponse(message) {
    return {
      status: "error",
      data: null,
      error: String(message || "Unknown error")
    };
  }

  /**
   * Returns true when a value is a valid Date instance.
   * @param {*} value
   * @returns {boolean}
   */
  function isValidDate(value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
  }

  /**
   * Converts supported values to Date without hidden fallbacks.
   * Supported inputs: Date, YYYY-MM-DD, DD.MM.YYYY.
   * @param {*} value
   * @returns {Date|null}
   */
  function parseDate(value) {
    try {
      if (isValidDate(value)) {
        return new Date(value.getTime());
      }

      if (typeof value !== "string") {
        return null;
      }

      const input = value.trim();

      if (!input) {
        return null;
      }

      const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) {
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]);
        const day = Number(isoMatch[3]);
        const parsed = new Date(year, month - 1, day);

        return isExactDateMatch(parsed, year, month, day) ? parsed : null;
      }

      const ruMatch = input.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (ruMatch) {
        const day = Number(ruMatch[1]);
        const month = Number(ruMatch[2]);
        const year = Number(ruMatch[3]);
        const parsed = new Date(year, month - 1, day);

        return isExactDateMatch(parsed, year, month, day) ? parsed : null;
      }

      return null;
    } catch (error) {
      logError("parseDate failed", error);
      return null;
    }
  }

  /**
   * Normalizes scalar values without inventing defaults.
   * @param {*} value
   * @returns {*}
   */
  function normalizeValue(value) {
    try {
      if (typeof value === "undefined" || value === null) {
        return null;
      }

      if (typeof value === "string") {
        return value.trim();
      }

      if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
      }

      if (isValidDate(value)) {
        return new Date(value.getTime());
      }

      return value;
    } catch (error) {
      logError("normalizeValue failed", error);
      return null;
    }
  }

  /**
   * Safely returns sheet rows by sheet name from workbook-like data.
   * Supports either workbookData[sheetName] or workbookData.sheets[sheetName].
   * @param {Object|null} workbookData
   * @param {string} sheetName
   * @returns {Array|null}
   */
  function getSheetByName(workbookData, sheetName) {
    try {
      if (!workbookData || typeof workbookData !== "object" || !sheetName) {
        return null;
      }

      if (Array.isArray(workbookData[sheetName])) {
        return workbookData[sheetName];
      }

      if (
        workbookData.sheets &&
        typeof workbookData.sheets === "object" &&
        Array.isArray(workbookData.sheets[sheetName])
      ) {
        return workbookData.sheets[sheetName];
      }

      return null;
    } catch (error) {
      logError("getSheetByName failed", { error, sheetName });
      return null;
    }
  }

  /**
   * Reads a sheet as an array of plain objects using the first row as headers.
   * Empty rows are skipped and the function never binds to specific column names.
   * @param {Object|null} workbookData
   * @param {string} sheetName
   * @returns {Array<Object>}
   */
  function readSheetAsObjects(workbookData, sheetName) {
    try {
      const sheet = getSheetByName(workbookData, sheetName);

      if (!Array.isArray(sheet) || sheet.length === 0) {
        return [];
      }

      const [headerRow, ...dataRows] = sheet;

      if (!Array.isArray(headerRow) || headerRow.length === 0) {
        return [];
      }

      const headers = headerRow.map((header, index) => {
        const normalizedHeader = normalizeValue(header);
        return normalizedHeader === null || normalizedHeader === ""
          ? `column_${index + 1}`
          : String(normalizedHeader);
      });

      return dataRows.reduce((accumulator, row) => {
        if (!Array.isArray(row) || isEmptyRow(row)) {
          return accumulator;
        }

        const record = {};
        headers.forEach((header, index) => {
          record[header] = normalizeValue(row[index]);
        });

        accumulator.push(record);
        return accumulator;
      }, []);
    } catch (error) {
      logError("readSheetAsObjects failed", { error, sheetName });
      return [];
    }
  }

  /**
   * Filters rows by a date interval using only valid dates.
   * @param {Array<Object>} rows
   * @param {string} dateColumn
   * @param {Date|string|null} start
   * @param {Date|string|null} end
   * @returns {Array<Object>}
   */
  function filterByDateRange(rows, dateColumn, start, end) {
    try {
      if (!Array.isArray(rows) || !dateColumn) {
        return [];
      }

      const normalizedStart = start ? startOfDay(parseDate(start)) : null;
      const normalizedEnd = end ? endOfDay(parseDate(end)) : null;

      return rows.filter((row) => {
        const rawDate = row ? row[dateColumn] : null;
        const parsedDate = parseDate(rawDate);

        if (!parsedDate) {
          return false;
        }

        if (normalizedStart && parsedDate < normalizedStart) {
          return false;
        }

        if (normalizedEnd && parsedDate > normalizedEnd) {
          return false;
        }

        return true;
      });
    } catch (error) {
      logError("filterByDateRange failed", error);
      return [];
    }
  }

  /**
   * Filters rows by transparent declarative conditions.
   * Condition shape:
   * { column: string, operator?: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'includes'|'in'|'exists'|'empty', value?: * }
   * @param {Array<Object>} rows
   * @param {Array<Object>} conditions
   * @returns {Array<Object>}
   */
  function filterByConditions(rows, conditions) {
    try {
      if (!Array.isArray(rows)) {
        return [];
      }

      if (!Array.isArray(conditions) || conditions.length === 0) {
        return rows.slice();
      }

      return rows.filter((row) =>
        conditions.every((condition) => {
          if (!condition || typeof condition !== "object" || !condition.column) {
            return true;
          }

          const operator = condition.operator || "eq";
          const handler = OPERATOR_HANDLERS[operator];

          if (typeof handler !== "function") {
            return false;
          }

          const rowValue = normalizeValue(row ? row[condition.column] : null);
          const conditionValue = normalizeValue(condition.value);
          const comparableRowValue = toComparableValue(rowValue);
          const comparableConditionValue = Array.isArray(condition.value)
            ? condition.value.map((item) => toComparableValue(normalizeValue(item)))
            : toComparableValue(conditionValue);

          return handler(comparableRowValue, comparableConditionValue);
        })
      );
    } catch (error) {
      logError("filterByConditions failed", error);
      return [];
    }
  }

  /**
   * Sorts rows by a column in ascending or descending order.
   * @param {Array<Object>} rows
   * @param {string} columnName
   * @param {'asc'|'desc'} [order='asc']
   * @returns {Array<Object>}
   */
  function sortByColumn(rows, columnName, order = "asc") {
    try {
      if (!Array.isArray(rows) || !columnName) {
        return [];
      }

      const direction = String(order).toLowerCase() === "desc" ? -1 : 1;

      return rows.slice().sort((leftRow, rightRow) => {
        const left = toComparableValue(normalizeValue(leftRow ? leftRow[columnName] : null));
        const right = toComparableValue(normalizeValue(rightRow ? rightRow[columnName] : null));

        if (left === right) {
          return 0;
        }

        if (left === null) {
          return 1;
        }

        if (right === null) {
          return -1;
        }

        if (typeof left === "string" && typeof right === "string") {
          return left.localeCompare(right, "ru") * direction;
        }

        return (left > right ? 1 : -1) * direction;
      });
    } catch (error) {
      logError("sortByColumn failed", error);
      return [];
    }
  }

  /**
   * Groups rows by a column value.
   * @param {Array<Object>} rows
   * @param {string} columnName
   * @returns {Record<string, Array<Object>>}
   */
  function groupByColumn(rows, columnName) {
    try {
      if (!Array.isArray(rows) || !columnName) {
        return {};
      }

      return rows.reduce((groups, row) => {
        const rawValue = normalizeValue(row ? row[columnName] : null);
        const groupKey = rawValue === null || rawValue === "" ? "__empty__" : String(rawValue);

        if (!groups[groupKey]) {
          groups[groupKey] = [];
        }

        groups[groupKey].push(row);
        return groups;
      }, {});
    } catch (error) {
      logError("groupByColumn failed", error);
      return {};
    }
  }

  /**
   * Sums a numeric column safely.
   * @param {Array<Object>} rows
   * @param {string} columnName
   * @returns {number}
   */
  function sumColumn(rows, columnName) {
    try {
      if (!Array.isArray(rows) || !columnName) {
        return 0;
      }

      return rows.reduce((sum, row) => sum + toNumber(row ? row[columnName] : null), 0);
    } catch (error) {
      logError("sumColumn failed", error);
      return 0;
    }
  }

  /**
   * Formats numeric values as currency using CONFIG.
   * @param {*} value
   * @returns {string}
   */
  function formatCurrency(value) {
    try {
      const numericValue = toNumber(value);
      const isNegative = numericValue < 0;
      const absoluteValue = Math.abs(numericValue);
      const fixed = absoluteValue.toFixed(CONFIG.DECIMAL_PLACES);
      const [integerPart, decimalPart] = fixed.split(".");
      const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, CONFIG.THOUSANDS_SEPARATOR);
      const formattedNumber = `${groupedInteger},${decimalPart}`;

      return `${isNegative ? "-" : ""}${formattedNumber} ${CONFIG.CURRENCY_SYMBOL}`;
    } catch (error) {
      logError("formatCurrency failed", error);
      return `0,${"0".repeat(CONFIG.DECIMAL_PLACES)} ${CONFIG.CURRENCY_SYMBOL}`;
    }
  }

  /**
   * Recursively sanitizes response payloads before they are consumed by the UI.
   * - Removes undefined values
   * - Converts NaN/Infinity to 0
   * - Converts Date to ISO string
   * @param {*} value
   * @returns {*}
   */
  function prepareResponse(value) {
    if (typeof value === "undefined") {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }

    if (isValidDate(value)) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => prepareResponse(item))
        .filter((item) => typeof item !== "undefined");
    }

    if (typeof value === "object") {
      return Object.keys(value).reduce((accumulator, key) => {
        const prepared = prepareResponse(value[key]);

        if (typeof prepared !== "undefined") {
          accumulator[key] = prepared;
        }

        return accumulator;
      }, {});
    }

    return value;
  }

  /**
   * Public placeholder API for the Money module.
   * @param {Object} [params={}]
   * @param {Object|null} [workbookData=null]
   * @returns {{status: string, data: *, error: string|null}}
   */
  function apiMoney(params = {}, workbookData = null) {
    return createModuleResponse("money", CONFIG.SHEETS.MONEY, params, workbookData);
  }

  /**
   * Public placeholder API for the Capital module.
   * @param {Object} [params={}]
   * @param {Object|null} [workbookData=null]
   * @returns {{status: string, data: *, error: string|null}}
   */
  function apiCapital(params = {}, workbookData = null) {
    return createModuleResponse("capital", CONFIG.SHEETS.CAPITAL, params, workbookData);
  }

  /**
   * Public placeholder API for the Profit module.
   * @param {Object} [params={}]
   * @param {Object|null} [workbookData=null]
   * @returns {{status: string, data: *, error: string|null}}
   */
  function apiProfit(params = {}, workbookData = null) {
    return createModuleResponse("profit", CONFIG.SHEETS.PROFIT, params, workbookData);
  }

  /**
   * Public placeholder API for the Dashboard module.
   * @param {Object} [params={}]
   * @param {Object|null} [workbookData=null]
   * @returns {{status: string, data: *, error: string|null}}
   */
  function apiDashboard(params = {}, workbookData = null) {
    return createModuleResponse("dashboard", null, params, workbookData);
  }

  /**
   * Returns the current workbook source URL from local storage or static config.
   * @returns {string}
   */
  function getDataSourceUrl() {
    try {
      if (typeof localStorage !== "undefined") {
        const storedUrl = localStorage.getItem(STORAGE_KEYS.DATA_SOURCE_URL);
        if (storedUrl && storedUrl.trim()) {
          return storedUrl.trim();
        }
      }
    } catch (error) {
      logError("Failed to read source URL from localStorage", error);
    }

    return CONFIG.DATA_SOURCE_URL;
  }

  /**
   * Persists the workbook source URL for all pages.
   * @param {string} url
   * @returns {string}
   */
  function setDataSourceUrl(url) {
    const normalizedUrl = typeof url === "string" && url.trim() ? url.trim() : CONFIG.DATA_SOURCE_URL;

    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEYS.DATA_SOURCE_URL, normalizedUrl);
      }
    } catch (error) {
      logError("Failed to persist source URL to localStorage", error);
    }

    return normalizedUrl;
  }

  /**
   * Returns the current workbook loader status.
   * @returns {{status: string, sourceUrl: string|null, downloadUrl: string|null, loadedAt: string|null, error: string|null}}
   */
  function getWorkbookLoadState() {
    return {
      status: workbookLoaderState.status,
      sourceUrl: workbookLoaderState.sourceUrl,
      downloadUrl: workbookLoaderState.downloadUrl,
      loadedAt: workbookLoaderState.loadedAt,
      error: workbookLoaderState.error
    };
  }

  /**
   * Loads workbook data from the configured source URL into window.workbookData.
   * The function resolves Yandex public links to a direct downloadable URL first.
   * @param {{sourceUrl?: string, forceRefresh?: boolean}} [options={}]
   * @returns {Promise<{status: string, data: *, error: string|null}>}
   */
  async function loadWorkbookData(options = {}) {
    const sourceUrl = options.sourceUrl ? String(options.sourceUrl).trim() : getDataSourceUrl();
    const forceRefresh = Boolean(options.forceRefresh);

    if (!sourceUrl) {
      const message = "Workbook source URL is empty.";
      workbookLoaderState.status = "error";
      workbookLoaderState.error = message;
      return prepareResponse(createErrorResponse(message));
    }

    if (!forceRefresh && workbookLoaderState.promise && workbookLoaderState.sourceUrl === sourceUrl) {
      return workbookLoaderState.promise;
    }

    if (!forceRefresh && window.workbookData && workbookLoaderState.sourceUrl === sourceUrl) {
      return prepareResponse(
        createSuccessResponse({
          sourceUrl,
          sheetNames: Array.isArray(window.workbookData.sheetNames) ? window.workbookData.sheetNames : [],
          loadedAt: workbookLoaderState.loadedAt,
          cached: true
        })
      );
    }

    workbookLoaderState.status = "loading";
    workbookLoaderState.sourceUrl = sourceUrl;
    workbookLoaderState.error = null;

    workbookLoaderState.promise = (async () => {
      try {
        if (typeof fetch !== "function") {
          throw new Error("Browser fetch API is not available.");
        }

        if (!window.XLSX || !window.XLSX.read || !window.XLSX.utils) {
          throw new Error("XLSX parser is not available on the page.");
        }

        const downloadUrl = await resolveDownloadUrl(sourceUrl);
        const fileResponse = await fetch(downloadUrl, {
          method: "GET",
          redirect: "follow",
          cache: "no-store"
        });

        if (!fileResponse.ok) {
          throw new Error(`Workbook download failed with HTTP ${fileResponse.status}.`);
        }

        const contentType = fileResponse.headers.get("content-type") || "";
        if (!/spreadsheetml|application\/octet-stream|application\/vnd\.ms-excel/i.test(contentType)) {
          logInfo("Workbook download content-type differs from the expected spreadsheet type", { contentType });
        }

        const workbookBuffer = await fileResponse.arrayBuffer();
        const workbook = window.XLSX.read(workbookBuffer, {
          type: "array",
          cellDates: true,
          dense: false
        });

        const workbookData = convertWorkbookToData(workbook, sourceUrl);
        window.workbookData = workbookData;
        workbookLoaderState.status = "success";
        workbookLoaderState.downloadUrl = downloadUrl;
        workbookLoaderState.loadedAt = new Date().toISOString();
        workbookLoaderState.error = null;

        return prepareResponse(
          createSuccessResponse({
            sourceUrl,
            downloadUrl,
            sheetNames: workbookData.sheetNames,
            loadedAt: workbookLoaderState.loadedAt,
            bytes: workbookBuffer.byteLength
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        workbookLoaderState.status = "error";
        workbookLoaderState.error = message;
        logError("Workbook loading failed", error);
        return prepareResponse(createErrorResponse(message));
      } finally {
        workbookLoaderState.promise = null;
      }
    })();

    return workbookLoaderState.promise;
  }

  async function resolveDownloadUrl(sourceUrl) {
    try {
      const normalizedUrl = String(sourceUrl || "").trim();
      if (!normalizedUrl) {
        throw new Error("Source URL is empty.");
      }

      const parsedUrl = new URL(normalizedUrl);
      if (!/yandex\./i.test(parsedUrl.hostname)) {
        return normalizedUrl;
      }

      const endpoint = `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(normalizedUrl)}`;
      const response = await fetch(endpoint, {
        method: "GET",
        redirect: "follow",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`Yandex public download API failed with HTTP ${response.status}.`);
      }

      const payload = await response.json();
      if (!payload || typeof payload.href !== "string" || !payload.href) {
        throw new Error("Yandex public link did not return a direct download URL.");
      }

      return payload.href;
    } catch (error) {
      logError("resolveDownloadUrl failed", error);
      throw error;
    }
  }

  function convertWorkbookToData(workbook, sourceUrl) {
    const workbookData = {
      sourceUrl,
      sheetNames: Array.isArray(workbook.SheetNames) ? workbook.SheetNames.slice() : [],
      sheets: {}
    };

    workbookData.sheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets ? workbook.Sheets[sheetName] : null;
      const rows = sheet
        ? window.XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: true,
            defval: null,
            blankrows: false,
            dateNF: "dd.mm.yyyy"
          })
        : [];

      workbookData.sheets[sheetName] = rows;
      workbookData[sheetName] = rows;
    });

    return workbookData;
  }

  function createModuleResponse(moduleName, sheetName, params, workbookData) {
    try {
      logInfo(`Creating API placeholder response for module: ${moduleName}`);

      const payload = {
        kpis: [],
        tables: [],
        charts: [],
        meta: {
          module: moduleName,
          sheetName,
          sourceUrl: getDataSourceUrl(),
          generatedAt: new Date(),
          hasWorkbookData: Boolean(workbookData),
          params: sanitizeParams(params)
        }
      };

      return prepareResponse(createSuccessResponse(payload));
    } catch (error) {
      logError(`API placeholder failed for module: ${moduleName}`, error);
      return prepareResponse(createErrorResponse(`Failed to build ${moduleName} response.`));
    }
  }

  function sanitizeParams(params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      return {};
    }

    return Object.keys(params).reduce((accumulator, key) => {
      const normalized = normalizeValue(params[key]);
      accumulator[key] = normalized;
      return accumulator;
    }, {});
  }

  function isExactDateMatch(dateValue, year, month, day) {
    return (
      isValidDate(dateValue) &&
      dateValue.getFullYear() === year &&
      dateValue.getMonth() === month - 1 &&
      dateValue.getDate() === day
    );
  }

  function startOfDay(dateValue) {
    if (!isValidDate(dateValue)) {
      return null;
    }

    return new Date(
      dateValue.getFullYear(),
      dateValue.getMonth(),
      dateValue.getDate(),
      0,
      0,
      0,
      0
    );
  }

  function endOfDay(dateValue) {
    if (!isValidDate(dateValue)) {
      return null;
    }

    return new Date(
      dateValue.getFullYear(),
      dateValue.getMonth(),
      dateValue.getDate(),
      23,
      59,
      59,
      999
    );
  }

  function isEmptyRow(row) {
    return row.every((cell) => {
      const normalized = normalizeValue(cell);
      return normalized === null || normalized === "";
    });
  }

  function toComparableValue(value) {
    if (value === null || value === "") {
      return null;
    }

    if (isValidDate(value)) {
      return value.getTime();
    }

    if (typeof value === "string") {
      const parsedDate = parseDate(value);
      if (parsedDate) {
        return parsedDate.getTime();
      }

      const numericValue = toNumber(value, true);
      return numericValue === null ? value : numericValue;
    }

    return value;
  }

  function toNumber(value, returnNullOnFailure = false) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : returnNullOnFailure ? null : 0;
    }

    if (typeof value === "string") {
      const sanitized = value.replace(/\s+/g, "").replace(",", ".");

      if (!sanitized) {
        return returnNullOnFailure ? null : 0;
      }

      const parsed = Number(sanitized);
      return Number.isFinite(parsed) ? parsed : returnNullOnFailure ? null : 0;
    }

    return returnNullOnFailure ? null : 0;
  }

  const GSCore = {
    CONFIG,
    getDataSourceUrl,
    setDataSourceUrl,
    getWorkbookLoadState,
    loadWorkbookData,
    createSuccessResponse,
    createErrorResponse,
    getSheetByName,
    readSheetAsObjects,
    normalizeValue,
    parseDate,
    filterByDateRange,
    filterByConditions,
    sortByColumn,
    groupByColumn,
    sumColumn,
    formatCurrency,
    prepareResponse,
    logDebug,
    logInfo,
    logError,
    apiMoney,
    apiCapital,
    apiProfit,
    apiDashboard
  };

  Object.freeze(CONFIG.SHEETS);
  Object.freeze(CONFIG.PERIODS);
  Object.freeze(CONFIG);
  Object.freeze(GSCore);

  window.GSCore = GSCore;
})();
