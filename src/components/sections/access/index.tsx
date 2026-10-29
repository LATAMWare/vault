import { t } from "@logic/i18n"
import { useEffect, useState, useRef } from "react"

import { showAlert } from "@logic/alert"
import { getStorage, setStorage } from "@logic/storage"
import { getSetting } from "@logic/settings"
import { applyThemeColor } from "@logic/settings"
import { buildMasterSeedBlocks } from "@logic/utils"
import {
    createAccount,
    getAccountIcon,
    getAccountName,
    setAccountMasterPassword,
    checkAccountMasterPassword
} from "@logic/account"

import Logo from "@component/ui/global/logo"
import OpenAnimation from "@component/sections/access/open-animation"
import Version from "@component/sections/settings/version"

interface AccessProps {
    onSubmitForm: (
        accountId: string,
        masterPassword: string
    ) => void
    onSectionChange: (section: string) => void
}

const Access = (props: AccessProps) => {

    const { onSubmitForm } = props

    const dropdownRef = useRef<HTMLDivElement | null>(null)

    const [ accountName, setAccountName ] = useState("")
    const [ accounts, setAccounts ] = useState<string[]>([])
    const [ selectedAccount, setSelectedAccount ] = useState<string | 'new'>('new')
    const [ dropdownOpen, setDropdownOpen ] = useState(false)
    const [ isOpeningVault, setIsOpeningVault ] = useState(false)
    const [ vaultOpened, setVaultOpened ] = useState(false)
    const [ showAnimations, setShowAnimations ] = useState(false)
    const [ masterPassword, setMasterPassword ] = useState("")
    const [ masterSeedBlocks, setMasterSeedBlocks ] = useState<Array<{ id: number, seed: string, color: { r: number, g: number, b: number }, token: string }>>([])

    const selectedAccountData = selectedAccount === 'new' ? null : getStorage(selectedAccount)
    const shouldShowMasterSeedBlocks = selectedAccount === 'new' || !selectedAccountData?.master?.verifier

    const handleSubmit = (event: any) => {

        event.preventDefault()

        if (isOpeningVault) return
        const password = event.target.password.value

        if(password === '') return showAlert(
            t("Please enter your Master Password"),
            'error',
            'exclamation-circle',
            5000
        )

        const newAccountName = selectedAccount === 'new'
            ? accountName.trim() || t('Personal Account')
            : getAccountName(selectedAccount)

        setAccountName(newAccountName)

        const proceed = async () => {
            setIsOpeningVault(true)

            if (!accounts || accounts.length === 0 || selectedAccount === 'new') {

                createAccount(newAccountName)

                const accountId = getStorage('current-account')

                if (accountId) await setAccountMasterPassword({
                    accountId,
                    masterPassword: password
                })

                const showAnimations = getSetting({ accountId, settingId: "show-animations" })

                setShowAnimations(showAnimations)

                if (showAnimations) {

                    setIsOpeningVault(true)

                    return setTimeout(() => {

                        setVaultOpened(true)

                        setTimeout(() => {
                            onSubmitForm(accountId, password)
                            setIsOpeningVault(false)
                        }, 500)

                    }, 500)
                }

                onSubmitForm(accountId, password)

                return

            }

            const isValidMasterPassword = await checkAccountMasterPassword({
                accountId: selectedAccount,
                masterPassword: password
            })

            if (!isValidMasterPassword) {

                setIsOpeningVault(false)

                return showAlert(
                    t("Master Password is incorrect for this account"),
                    'error',
                    'exclamation-circle',
                    5000
                )

            }
            
            const showAnimations = getSetting({ accountId: selectedAccount, settingId: "show-animations" })

            setShowAnimations(showAnimations)

            if(showAnimations) {

                setIsOpeningVault(true)
    
                return setTimeout(() => {
    
                    setVaultOpened(true)
    
                    setTimeout(() => {

                        onSubmitForm(selectedAccount, password)
                        setStorage("current-account", selectedAccount)
                        setIsOpeningVault(false)

                        return 

                    }, 800)
    
                }, 1000)

            }

            onSubmitForm(selectedAccount, password)
            setStorage("current-account", selectedAccount)

        }

        proceed().catch((error: unknown) => {
            setIsOpeningVault(false)
            showAlert(error instanceof Error ? error.message : t("Could not unlock the account"), "error", "exclamation-circle", 5000)
        })

    }

    useEffect(() => {

        const accounts = getStorage("accounts") || []
        setAccounts(accounts)

        const account = getStorage("current-account") || []
        if (account && account.length > 0) setSelectedAccount(account)

    }, [])

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    useEffect(() => {
        if (selectedAccount) {
            applyThemeColor(selectedAccount)
        }
    }, [selectedAccount])

    useEffect(() => {
        let isMounted = true

        if (!shouldShowMasterSeedBlocks || !masterPassword) {
            setMasterSeedBlocks([])
            return () => {
                isMounted = false
            }
        }

        buildMasterSeedBlocks(masterPassword).then((blocks) => {
            if (isMounted) setMasterSeedBlocks(blocks)
        })

        return () => {
            isMounted = false
        }
    }, [masterPassword, shouldShowMasterSeedBlocks])

    const selectedAccountIcon = selectedAccount === 'new'
        ? 'user-plus'
        : getAccountIcon(selectedAccount)

    return (
        <div className="relative lite:bg-darker lite:border-white/10 bg-white/2 border-white/10 w-full h-full squircle-md border overflow-hidden">

            <Version />

            <div className="absolute inset-0 overflow-y-scroll no-scrollbar-but-scroll">

                <div className="z-50 mx-auto flex min-h-full w-full max-w-full flex-col items-center justify-center p-5 md:max-w-300">
                    
                    <Logo />

                    <div className="text-2xl md:text-4xl text-center mb-10"> {t("Local password manager for")} <b className="font-inter-black">LATAMWare</b>
                    </div>

                    <div className="flex flex-col gap-10 max-w-95">

                        <div className="text-center">
                            <h1 className="text-xl font-inter-bold">{selectedAccount === 'new' ? t("Create local account") : t("Unlock local account")}</h1>
                            <p className="mt-2 text-sm text-white/65">{t("A local account groups your vaults under one master password. Vaults are folders for services and secrets.")}</p>
                        </div>
                        
                        <form
                            onSubmit={ handleSubmit }
                            className="flex flex-col gap-2"
                        >

                            { accounts && accounts.length > 0 && (

                                <div className="relative w-full" ref={dropdownRef}>

                                    <button
                                        type="button"
                                        onClick={() => setDropdownOpen(!dropdownOpen)}
                                        className="text-md md:text-xl font-inter-medium h-fit w-full squircle-md px-5 py-3 border duration-300 bg-white/5 border-white/20 focus:bg-white/10 focus:border-white/50 hover:bg-white/10 hover:border-white/50 hover:text-white flex items-center justify-center text-center cursor-pointer"
                                    >
                                        <span className="flex min-w-0 items-center gap-2 text-left">
                                            <i className={`ti ti-${selectedAccountIcon} text-xl`} />
                                            <span className="truncate">
                                                { selectedAccount === 'new' ? t("Create local account") : getAccountName(selectedAccount) }
                                            </span>
                                        </span>
                                        <i className={`ti ${dropdownOpen ? 'ti-chevron-up' : 'ti-chevron-down'} ml-2`} />
                                    </button>

                                    { dropdownOpen && (
                                        <ul className="absolute left-0 right-0 mt-0.5 max-h-60 overflow-y-auto squircle-md bg-white/5 backdrop-blur-xl lite:backdrop-blur-none border border-white/30">
                                            <li
                                                key="new"
                                                onClick={() => {
                                                    setSelectedAccount('new')
                                                    setAccountName('')
                                                    setDropdownOpen(false)
                                                }}
                                                className="px-5 py-3 cursor-pointer hover:bg-white/10 border-b border-white/10 last:border-transparent lite:bg-darker lite:hover:bg-darker lite:hover:text-primary"
                                            >
                                                <div className="flex items-center justify-center gap-2">
                                                    <i className="ti ti-user-plus text-lg" />
                                                    <span className="font-inter-medium text-lg"> {t("Create local account")} </span>
                                                </div>
                                            </li>

                                            { accounts.map((accountId) => {

                                                const account = getStorage(accountId) || {}

                                                let label = accountId
                                                let icon = 'user'

                                                if (account.settings) {

                                                    const nameSetting = account.settings.find((setting: any) => setting.id === 'account-name')
                                                    const iconSetting = account.settings.find((setting: any) => setting.id === 'account-icon')

                                                    if (nameSetting) label = nameSetting.value
                                                    if (iconSetting) icon = iconSetting.value

                                                }

                                                return (
                                                    <li
                                                        key={accountId}
                                                        onClick={() => {
                                                            setSelectedAccount(accountId)
                                                            setAccountName(label)
                                                            setDropdownOpen(false)
                                                        }}
                                                        className="px-5 py-3 cursor-pointer hover:bg-white/10 text-center border-b border-white/10 last:border-transparent lite:bg-darker lite:hover:bg-darker lite:hover:text-primary"
                                                    >
                                                        <div className="flex flex-col items-center justify-center gap-2">
                                                            <div className="font-inter-medium text-lg">
                                                                <i className={`ti ti-${icon} text-lg mr-2`} />
                                                                <span>{label}</span>
                                                            </div>
                                                            <span className="text-[10px] -mt-2 text-white/50">
                                                                {accountId}
                                                            </span>
                                                        </div>
                                                    </li>
                                                )

                                            }) }

                                        </ul>
                                    )}

                                </div>

                            )}

                            { (!accounts || accounts.length === 0 || selectedAccount === 'new') && (
                                <input
                                    placeholder={t("Local account name")}
                                    type="text"
                                    name="account-name"
                                    value={accountName}
                                    onChange={(event) => setAccountName(event.target.value)}
                                    className="text-md md:text-xl font-inter-medium h-fit w-full squircle-md px-5 py-3 border text-center duration-300 bg-white/5 border-white/20 focus:bg-white/10 focus:border-white/50 hover:bg-white/10 hover:border-white/50 hover:text-white"
                                />
                            )}

                            <input
                                placeholder={t("Enter your Master Password")}
                                type="password"
                                name="password"
                                value={masterPassword}
                                onChange={(event) => setMasterPassword(event.target.value)}
                                className="text-md md:text-xl font-inter-medium h-fit w-full squircle-md px-5 py-3 border text-center duration-300 bg-white/5 border-white/20 focus:bg-white/10 focus:border-white/50 hover:bg-white/10 hover:border-white/50 hover:text-white"
                            />

                            <button
                                type="submit"
                                disabled={isOpeningVault}
                                className={`text-md md:text-xl h-fit w-full squircle-md px-5 py-4 border cursor-pointer duration-300 transition bg-primary/10 border-primary/60 hover:bg-primary/30 hover:to-primary/30 hover:border-primary hover:text-white text-white/60 text-center font-inter-black ${isOpeningVault ? 'pointer-events-none opacity-60' : ''}`}
                            >
                                {isOpeningVault ? selectedAccount === 'new' ? t("Creating...") : t("Unlocking...") : (accounts && accounts.length > 0 && selectedAccount !== 'new' ? t("Unlock local account") : t("Create local account"))}
                            </button>

                            { shouldShowMasterSeedBlocks && (
                                <div className="flex flex-col gap-3 p-4 text-left max-w-full bg-white/2 border-white/10 border squircle-md">
                                    <div>
                                        <h3 className="font-inter-bold text-lg">
                                            <i className="ti ti-square-f0 mr-0.5 align-middle inline-block -mt-0.5" /> {t("Password verification tokens")} </h3>
                                        <div className="text-xs text-white/60"> {t("Use these tokens to recognize your master password. They cannot recover it.")}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                        { masterSeedBlocks.length > 0 ? masterSeedBlocks.map((block) => (
                                            <div
                                                style={{ background: `rgba(${block.color.r}, ${block.color.g}, ${block.color.b}, 0.2)`, borderColor: `rgba(${block.color.r}, ${block.color.g}, ${block.color.b}, 0.8)` }}
                                                key={ block.id }
                                                className="squircle-md border px-2 py-1 flex items-center justify-between gap-2 text-white/80"
                                            >
                                                <div className="text-lg font-inter-black">{ block.token }</div>
                                                <span className="block h-5 w-5 squircle-full" style={{ backgroundColor: `rgba(${block.color.r}, ${block.color.g}, ${block.color.b}, 1)` }}></span>
                                            </div>
                                        )) : (
                                            <div className="col-span-2 text-sm text-white/50 md:col-span-4"> {t("Enter your Master Password to view the tokens.")} </div>
                                        ) }
                                    </div>
                                </div>
                            )}

                        </form>
                    </div>

                </div>

            </div>

            { showAnimations && isOpeningVault && (
                <OpenAnimation vaultOpened={vaultOpened} />
            )}

        </div>
    )

}

export default Access
