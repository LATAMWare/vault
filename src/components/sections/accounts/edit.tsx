import { t } from "@logic/i18n"
import { useEffect, useState } from "react"

import { getAccountName, deleteAccount, changeMasterPassword, checkAccountMasterPassword } from "@logic/account"
import { getStorage, setStorage } from "@logic/storage"
import { showAlert } from "@logic/alert"

import Input from "@component/ui/form/input"
import IconSelector from "@component/ui/form/icon"
import Dialog from "@component/ui/dialog/dialog"
import DialogOption from "@component/ui/dialog/option"
import DialogFooter from "@component/ui/dialog/footer"

type EditAccountModalProps = {
    open: boolean
    accountId: string
    onUpdate: () => void
    onClose: () => void
    onPasswordChanged: (masterPassword: string) => void
}

const EditAccountModal = (props: EditAccountModalProps) => {

    const { open, accountId, onUpdate, onClose, onPasswordChanged } = props

    const getEmptyForm = () => ({
        name: "",
        icon: "user"
    })

    const [ form, setForm ] = useState(getEmptyForm())
    const [ currentMasterPassword, setCurrentMasterPassword ] = useState<string>("")
    const [ newMasterPassword, setNewMasterPassword ] = useState<string>("")
    const [ deleteMasterPassword, setDeleteMasterPassword ] = useState<string>("")
    const [ isDeleteConfirmOpen, setIsDeleteConfirmOpen ] = useState(false)
    const [ isPasswordConfirmOpen, setIsPasswordConfirmOpen ] = useState(false)
    const [ closeOtherSessions, setCloseOtherSessions ] = useState(true)
    const [ isChangingPassword, setIsChangingPassword ] = useState(false)

    useEffect(() => {
        if (!open || !accountId) {
            setForm(getEmptyForm())
            return
        }

        const account = getStorage(accountId)
        const accountName = getAccountName(accountId)
        const accountIcon = account?.settings?.find((s: any) => s.id === "account-icon")?.value || "user"

        setForm({ name: accountName, icon: accountIcon })
    }, [ open, accountId ])

    const handleClose = () => {
        setForm(getEmptyForm())
        setCurrentMasterPassword("")
        setNewMasterPassword("")
        setIsPasswordConfirmOpen(false)
        onClose()
    }

    const handleSubmit = () => {

        const currentAccountId = getStorage("current-account") || ""

        if (currentAccountId !== accountId) {
            showAlert(t("Only the active account can be edited."), "error", "alert-circle", 3000)
            onClose()
            return
        }

        const nextName = form.name.trim()

        if (!nextName) {
            showAlert(t("Please enter an account name"), "error", "alert-circle", 3000)
            return
        }

        const account = getStorage(accountId)
        if (!account || !Array.isArray(account.settings)) {
            showAlert(t("Unable to update this account"), "error", "alert-circle", 3000)
            return
        }

        const settings = account.settings.map((setting: any) => {
            if (setting.id === "account-name") {
                return { ...setting, value: nextName }
            }
            if (setting.id === "account-icon") {
                return { ...setting, value: form.icon }
            }
            return setting
        })

        setStorage(accountId, { ...account, settings })
        showAlert(t("{{value0}} account updated successfully!", { value0: nextName }), "success", "check", 5000)
        onUpdate()
        onClose()

    }

    const handleDelete = () => {
        if (!accountId) return

        const currentAccountId = getStorage("current-account") || ""

        if (currentAccountId !== accountId) {
            showAlert(t("Only the active account can be edited."), "error", "alert-circle", 3000)
            onClose()
            return
        }

        setDeleteMasterPassword("")
        setIsDeleteConfirmOpen(true)
    }

    const handleDeleteSubmit = async () => {
        if (!deleteMasterPassword.trim()) {
            showAlert(t("Please enter your Master Password"), "error", "exclamation-circle", 5000)
            return
        }

        const isValidPassword = await checkAccountMasterPassword({
            accountId,
            masterPassword: deleteMasterPassword
        })

        if (!isValidPassword) {
            showAlert(t("Master Password is incorrect"), "error", "exclamation-circle", 5000)
            return
        }



        deleteAccount(accountId)

        if (getStorage("current-account") === accountId) {
            setStorage("current-account", "")
        }

        setDeleteMasterPassword("")
        setIsDeleteConfirmOpen(false)

        showAlert(t("Account deleted successfully"), "success", "check", 5000)
        onUpdate()
        onClose()

        window.location.reload()
    }

    const handleChangeMasterPasswordSubmit = async () => {

        if (!currentMasterPassword) {
            return showAlert(t("Please enter your current Master Password"), 'error', 'exclamation-circle', 5000)
        }

        const isValidPassword = await checkAccountMasterPassword({
            accountId,
            masterPassword: currentMasterPassword
        })

        if (!isValidPassword) {
            return showAlert(t("Current Master Password is incorrect"), 'error', 'exclamation-circle', 5000)
        }

        if(!newMasterPassword) {
            return showAlert(t("Please enter a new Master Password"), 'error', 'exclamation-circle', 5000)
        }

        if(newMasterPassword === currentMasterPassword) {
            return showAlert(t("New Master Password cannot be the same as the current"), 'error', 'exclamation-circle', 5000)
        }

        setCloseOtherSessions(true)
        setIsPasswordConfirmOpen(true)
    }

    const confirmPasswordChange = async () => {
        if (isChangingPassword) return
        setIsChangingPassword(true)
        const success = await changeMasterPassword({
            accountId,
            currentMasterPassword,
            newMasterPassword,
            closeOtherSessions
        })
        setIsChangingPassword(false)
        if (success) {
            onPasswordChanged(newMasterPassword)
            setCurrentMasterPassword("")
            setNewMasterPassword("")
            setIsPasswordConfirmOpen(false)
            onUpdate()
            onClose()
        }

    }

    return (
        <>
            <Dialog
                open={isPasswordConfirmOpen}
                title={t("Change Master Password")}
                dismissible={!isChangingPassword}
                onClose={() => { if (!isChangingPassword) setIsPasswordConfirmOpen(false) }}
                footer={<DialogFooter buttons={[
                    { label: t("Cancel"), variant: "cancel", disabled: isChangingPassword, onClick: () => setIsPasswordConfirmOpen(false) },
                    { label: isChangingPassword ? t("Changing...") : t("Confirm change"), variant: "success", disabled: isChangingPassword, onClick: confirmPasswordChange }
                ]} />}
            >
                <p className="mb-4">{t("Your secrets will be encrypted with the new master password. Your existing service passwords will stay the same.")}</p>
                <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={closeOtherSessions} disabled={isChangingPassword || typeof BroadcastChannel === "undefined"} onChange={event => setCloseOtherSessions(event.target.checked)} /> {t("Close other sessions of this account")} </label>
                <p className="mt-3 text-sm text-white/60">{t("Applies to other tabs of this browser on this site. Other devices and the Chrome extension are independent and must be locked separately.")}</p>
            </Dialog>
            <Dialog
                open={open && !isPasswordConfirmOpen}
                title={t("Edit Account")}
                onClose={handleClose}
                contentClassName="flex flex-col"
                footer={
                    <DialogFooter
                        buttons={[
                            {
                                label: t("Delete"),
                                variant: "delete",
                                onClick: handleDelete
                            },
                            {
                                label: t("Cancel"),
                                variant: "cancel",
                                position: "end",
                                onClick: handleClose
                            },
                            {
                                label: t("Save"),
                                variant: "success",
                                position: "end",
                                onClick: handleSubmit
                            }
                        ]}
                    />
                }
            >
                <DialogOption
                    title={t("Account Name")}
                    description={t("Update the display name for this account")}
                    layout="row"
                >
                    <Input
                        id="account-edit-name"
                        name="account-edit-name"
                        type="text"
                        value={form.name}
                        placeholder={t("My Personal Account")}
                        onChange={(event: any) => {
                            setForm({ ...form, name: event.target.value })
                        }}
                        className="font-inter-medium h-fit w-full px-3 py-2 border duration-300 bg-white/5 border-white/20 focus:bg-white/10 focus:border-white/50 hover:bg-white/10 hover:border-white/50 hover:text-white squircle-md"
                    />
                </DialogOption>
                <DialogOption
                    title={t("Account Icon")}
                    description={t("Update the icon for this account")}
                    layout="row"
                >
                    <IconSelector
                        id="account-edit-icon"
                        value={form.icon}
                        onChange={({ value }: { settingId: string, value: string }) => {
                            setForm({ ...form, icon: value })
                        }}
                    />
                </DialogOption>
                <DialogOption
                    title={t("Change Master Password")}
                    description={t("Encrypt your secrets with a new master password while preserving existing service passwords. Keep an encrypted backup before changing it.")}
                    layout="col"
                >
                    <div className="w-full">
                        <Input
                            id="current-master-password-edit"
                            type="password"
                            placeholder={t("Current Master Password")}
                            value={ currentMasterPassword }
                            onChange={ (event: React.ChangeEvent<HTMLInputElement>) => setCurrentMasterPassword(event.target.value) }
                            className="font-inter-medium h-fit w-full px-3 py-2 border duration-300 bg-white/5 border-white/20 focus:bg-white/10 focus:border-white/50 hover:bg-white/10 hover:border-white/50 hover:text-white squircle-md mb-3"
                        />
                        <Input
                            id="new-master-password-edit"
                            type="password"
                            placeholder={t("New Master Password")}
                            value={ newMasterPassword }
                            onChange={ (event: React.ChangeEvent<HTMLInputElement>) => setNewMasterPassword(event.target.value) }
                            className="font-inter-medium h-fit w-full px-3 py-2 border duration-300 bg-white/5 border-white/20 focus:bg-white/10 focus:border-white/50 hover:bg-white/10 hover:border-white/50 hover:text-white squircle-md mb-3"
                        />
                        <button
                            onClick={ handleChangeMasterPasswordSubmit }
                            className="font-inter-bold h-fit w-full px-3 py-3 border duration-300 bg-rose-500/10 border-rose-500/50 hover:bg-rose-500/20 hover:border-rose-500 hover:text-white focus:bg-rose-500/20 focus:border-rose-500 squircle-md cursor-pointer"
                        > {t("Change Master Password")} </button>
                    </div>
                </DialogOption>
            </Dialog>

            <Dialog
                open={isDeleteConfirmOpen}
                title={t("Delete Account")}
                onClose={() => {
                    setDeleteMasterPassword("")
                    setIsDeleteConfirmOpen(false)
                }}
                contentClassName="flex flex-col gap-4 p-5"
                footer={
                    <DialogFooter
                        buttons={[
                            {
                                label: t("Cancel"),
                                variant: "cancel",
                                onClick: () => {
                                    setDeleteMasterPassword("")
                                    setIsDeleteConfirmOpen(false)
                                }
                            },
                            {
                                label: t("Delete"),
                                variant: "delete",
                                position: "end",
                                onClick: handleDeleteSubmit
                            }
                        ]}
                    />
                }
            >
                <DialogOption
                    title={t("Confirm deletion")}
                    description={t("This action will permanently delete the account and all its data. Enter the Master Password to continue.")}
                    layout="col"
                    className="max-w-100"
                >
                    <Input
                        id="delete-account-master-password"
                        type="password"
                        placeholder={t("Master Password")}
                        value={deleteMasterPassword}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDeleteMasterPassword(event.target.value)}
                        className="font-inter-medium h-fit w-full px-3 py-2 border duration-300 bg-white/5 border-white/20 focus:bg-white/10 focus:border-white/50 hover:bg-white/10 hover:border-white/50 hover:text-white squircle-md"
                    />
                </DialogOption>
            </Dialog>
        </>
    )
}

export default EditAccountModal
