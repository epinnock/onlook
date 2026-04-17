const CONTACTS_MODULE_ID = 'expo-contacts';
const CALENDAR_MODULE_ID = 'expo-calendar';
const MODULE_IDS = [CONTACTS_MODULE_ID, CALENDAR_MODULE_ID];
const RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';

const PERMISSION_RESPONSE = Object.freeze({
  status: 'granted',
  granted: true,
  canAskAgain: true,
  expires: 'never',
});

const CONTACT_FIELDS = Object.freeze({
  Addresses: 'addresses',
  Birthday: 'birthday',
  Company: 'company',
  Emails: 'emails',
  FirstName: 'firstName',
  ID: 'id',
  Image: 'image',
  JobTitle: 'jobTitle',
  LastName: 'lastName',
  MiddleName: 'middleName',
  Name: 'name',
  Note: 'note',
  PhoneNumbers: 'phoneNumbers',
  Thumbnail: 'thumbnail',
});

const CONTACT_SORT_TYPES = Object.freeze({
  FirstName: 'firstName',
  LastName: 'lastName',
  UserDefault: 'userDefault',
});

const CALENDAR_ENTITY_TYPES = Object.freeze({
  EVENT: 'event',
  REMINDER: 'reminder',
});

const DEFAULT_SOURCE = Object.freeze({
  id: 'preview-source',
  isLocalAccount: true,
  name: 'Onlook Preview',
  type: 'local',
});

const DEFAULT_EVENT_CALENDAR = Object.freeze({
  id: 'preview-calendar',
  title: 'Onlook Preview',
  name: 'Onlook Preview',
  entityType: CALENDAR_ENTITY_TYPES.EVENT,
  source: DEFAULT_SOURCE,
  sourceId: DEFAULT_SOURCE.id,
  color: '#2563eb',
  isPrimary: true,
});

const DEFAULT_REMINDER_CALENDAR = Object.freeze({
  id: 'preview-reminders',
  title: 'Onlook Reminders',
  name: 'Onlook Reminders',
  entityType: CALENDAR_ENTITY_TYPES.REMINDER,
  source: DEFAULT_SOURCE,
  sourceId: DEFAULT_SOURCE.id,
  color: '#10b981',
  isPrimary: true,
});

function ensureRuntimeShimRegistry(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('expo productivity shim requires an object target');
  }

  if (!target[RUNTIME_SHIM_REGISTRY_KEY] || typeof target[RUNTIME_SHIM_REGISTRY_KEY] !== 'object') {
    target[RUNTIME_SHIM_REGISTRY_KEY] = {};
  }

  return target[RUNTIME_SHIM_REGISTRY_KEY];
}

function clonePermissionResponse() {
  return { ...PERMISSION_RESPONSE };
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (value && typeof value === 'object') {
    return { ...value };
  }

  return value;
}

function createIdFactory(prefix) {
  let current = 0;

  return function nextId() {
    current += 1;
    return `${prefix}-${current}`;
  };
}

function createContactsPermissionResponse() {
  return clonePermissionResponse();
}

function createCalendarPermissionResponse() {
  return clonePermissionResponse();
}

function createNullComponent(displayName) {
  function NullComponent() {
    return null;
  }

  NullComponent.displayName = displayName;
  return NullComponent;
}

function createExpoContactsModule() {
  const nextContactId = createIdFactory('preview-contact');
  const nextGroupId = createIdFactory('preview-group');
  const nextContainerId = createIdFactory('preview-container');

  const moduleExports = {
    ContactAccessButton: createNullComponent('ContactAccessButton'),
    Fields: CONTACT_FIELDS,
    SortTypes: CONTACT_SORT_TYPES,
    async addContactAsync(contact) {
      return contact?.id ?? nextContactId();
    },
    async addExistingGroupToContainerAsync() {
      return null;
    },
    async createGroupAsync() {
      return nextGroupId();
    },
    async getContactByIdAsync() {
      return undefined;
    },
    async getContactsAsync() {
      return {
        data: [],
        hasNextPage: false,
        hasPreviousPage: false,
        total: 0,
      };
    },
    async getContainersAsync() {
      return [];
    },
    async getDefaultContainerIdAsync() {
      return nextContainerId();
    },
    async getGroupsAsync() {
      return [];
    },
    async getPagedContactsAsync() {
      return {
        data: [],
        hasNextPage: false,
        hasPreviousPage: false,
        total: 0,
      };
    },
    async getPermissionsAsync() {
      return createContactsPermissionResponse();
    },
    async hasContactsAsync() {
      return false;
    },
    async isAvailableAsync() {
      return true;
    },
    async presentAccessPickerAsync() {
      return [];
    },
    async presentFormAsync() {
      return null;
    },
    async removeContactAsync() {
      return undefined;
    },
    async removeContactFromGroupAsync() {
      return undefined;
    },
    async removeGroupAsync() {
      return undefined;
    },
    async requestPermissionsAsync() {
      return createContactsPermissionResponse();
    },
    async shareContactAsync() {
      return null;
    },
    async updateContactAsync(contact) {
      return contact?.id ?? nextContactId();
    },
    async updateGroupNameAsync() {
      return null;
    },
    async writeContactToFileAsync() {
      return 'file://onlook-preview-contacts.vcf';
    },
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function filterCalendars(entityType) {
  if (entityType === CALENDAR_ENTITY_TYPES.EVENT) {
    return [cloneValue(DEFAULT_EVENT_CALENDAR)];
  }

  if (entityType === CALENDAR_ENTITY_TYPES.REMINDER) {
    return [cloneValue(DEFAULT_REMINDER_CALENDAR)];
  }

  return [
    cloneValue(DEFAULT_EVENT_CALENDAR),
    cloneValue(DEFAULT_REMINDER_CALENDAR),
  ];
}

function createPermissionHook(permissionFactory) {
  return function usePermissionShim() {
    const requestPermission = async () => permissionFactory();
    const getPermission = async () => permissionFactory();

    return [permissionFactory(), requestPermission, getPermission];
  };
}

function createExpoCalendarModule() {
  const nextCalendarId = createIdFactory('preview-calendar');
  const nextEventId = createIdFactory('preview-event');
  const nextReminderId = createIdFactory('preview-reminder');
  const nextAttendeeId = createIdFactory('preview-attendee');

  const moduleExports = {
    EntityTypes: CALENDAR_ENTITY_TYPES,
    async createAttendeeAsync() {
      return nextAttendeeId();
    },
    async createCalendarAsync(details = {}) {
      return details.id ?? nextCalendarId();
    },
    async createEventAsync(_calendarId, eventData = {}) {
      return eventData.id ?? nextEventId();
    },
    async createEventInCalendarAsync(eventData = {}) {
      return {
        action: 'saved',
        id: eventData.id ?? nextEventId(),
      };
    },
    async createReminderAsync(_calendarId, reminder = {}) {
      return reminder.id ?? nextReminderId();
    },
    async deleteAttendeeAsync() {
      return undefined;
    },
    async deleteCalendarAsync() {
      return undefined;
    },
    async deleteEventAsync() {
      return undefined;
    },
    async deleteReminderAsync() {
      return undefined;
    },
    async editEventInCalendarAsync(params = {}) {
      return {
        action: 'saved',
        id: params.id ?? nextEventId(),
      };
    },
    async getAttendeesForEventAsync() {
      return [];
    },
    async getCalendarPermissionsAsync() {
      return createCalendarPermissionResponse();
    },
    async getCalendarsAsync(entityType) {
      return filterCalendars(entityType);
    },
    async getDefaultCalendarAsync() {
      return cloneValue(DEFAULT_EVENT_CALENDAR);
    },
    async getEventAsync(id) {
      if (!id) {
        return null;
      }

      return {
        id,
        calendarId: DEFAULT_EVENT_CALENDAR.id,
        title: 'Onlook Preview Event',
        startDate: new Date(0),
        endDate: new Date(0),
      };
    },
    async getEventsAsync() {
      return [];
    },
    async getPermissionsAsync() {
      return createCalendarPermissionResponse();
    },
    async getReminderAsync(id) {
      if (!id) {
        return null;
      }

      return {
        id,
        calendarId: DEFAULT_REMINDER_CALENDAR.id,
        title: 'Onlook Preview Reminder',
      };
    },
    async getRemindersAsync() {
      return [];
    },
    async getRemindersPermissionsAsync() {
      return createCalendarPermissionResponse();
    },
    async getSourceAsync(id) {
      if (!id) {
        return null;
      }

      return {
        ...cloneValue(DEFAULT_SOURCE),
        id,
      };
    },
    async getSourcesAsync() {
      return [cloneValue(DEFAULT_SOURCE)];
    },
    async isAvailableAsync() {
      return true;
    },
    openEventInCalendar() {},
    async openEventInCalendarAsync(params = {}) {
      return {
        action: 'done',
        id: params.id ?? null,
      };
    },
    async requestCalendarPermissionsAsync() {
      return createCalendarPermissionResponse();
    },
    async requestPermissionsAsync() {
      return createCalendarPermissionResponse();
    },
    async requestRemindersPermissionsAsync() {
      return createCalendarPermissionResponse();
    },
    async updateAttendeeAsync(id) {
      return id ?? nextAttendeeId();
    },
    async updateCalendarAsync(id) {
      return id ?? nextCalendarId();
    },
    async updateEventAsync(id) {
      return id ?? nextEventId();
    },
    async updateReminderAsync(id) {
      return id ?? nextReminderId();
    },
    useCalendarPermissions: createPermissionHook(createCalendarPermissionResponse),
    useRemindersPermissions: createPermissionHook(createCalendarPermissionResponse),
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function mergeRuntimeModule(existingModule, nextModule) {
  for (const [key, value] of Object.entries(nextModule)) {
    if (key === 'default') {
      continue;
    }

    if (!(key in existingModule)) {
      existingModule[key] = value;
    }
  }

  existingModule.default = existingModule.default ?? existingModule;
  existingModule.__esModule = true;
  return existingModule;
}

function installModule(registry, moduleId, createModule) {
  const existingModule = registry[moduleId];
  const nextModule = createModule();

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, nextModule);
  }

  registry[moduleId] = nextModule;
  return nextModule;
}

function createExpoProductivityModules() {
  return {
    [CONTACTS_MODULE_ID]: createExpoContactsModule(),
    [CALENDAR_MODULE_ID]: createExpoCalendarModule(),
  };
}

function installExpoProductivityShim(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);

  return {
    [CONTACTS_MODULE_ID]: installModule(
      registry,
      CONTACTS_MODULE_ID,
      createExpoContactsModule,
    ),
    [CALENDAR_MODULE_ID]: installModule(
      registry,
      CALENDAR_MODULE_ID,
      createExpoCalendarModule,
    ),
  };
}

module.exports = installExpoProductivityShim;
module.exports.install = installExpoProductivityShim;
module.exports.applyRuntimeShim = installExpoProductivityShim;
module.exports.createExpoContactsModule = createExpoContactsModule;
module.exports.createExpoCalendarModule = createExpoCalendarModule;
module.exports.createExpoProductivityModules = createExpoProductivityModules;
module.exports.ensureRuntimeShimRegistry = ensureRuntimeShimRegistry;
module.exports.mergeRuntimeModule = mergeRuntimeModule;
module.exports.CONTACTS_MODULE_ID = CONTACTS_MODULE_ID;
module.exports.CALENDAR_MODULE_ID = CALENDAR_MODULE_ID;
module.exports.MODULE_IDS = MODULE_IDS;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
module.exports.CONTACT_FIELDS = CONTACT_FIELDS;
module.exports.CONTACT_SORT_TYPES = CONTACT_SORT_TYPES;
module.exports.CALENDAR_ENTITY_TYPES = CALENDAR_ENTITY_TYPES;
