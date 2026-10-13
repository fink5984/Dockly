import onboarding from './onboarding'
import dashboard from './dashboard'
import activity from './activity'
import requests from './requests'
import clients from './clients'
import signatures from './signatures'
import portal from './portal'
import documents from './documents'
import templates from './templates'
import settings from './settings'
import sign from './sign'

type Section = { en: Record<string, unknown>; he: Record<string, unknown> }
export const sections: Record<string, Section> = { onboarding, dashboard, activity, requests, clients, signatures, portal, documents, templates, settings, sign }
