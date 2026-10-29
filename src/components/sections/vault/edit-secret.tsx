import { t } from "@logic/i18n"
import { useEffect, useState, useRef } from "react"

import { updateSecret, getSecretContent, deleteSecret } from "@logic/secret"
import { getStorage } from "@logic/storage"
import { getVaultList } from "@logic/vault"
import { showAlert } from "@logic/alert"

import IconSelector from "@component/ui/form/icon"
import Select from "@component/ui/form/select"
import Input from "@component/ui/form/input"
import Dialog from "@component/ui/dialog/dialog"
import DialogOption from "@component/ui/dialog/option"
import DialogFooter from "@component/ui/dialog/footer"

import type { ISecret } from "@interface/index"

type SecretModalProps = {
    open: boolean
    vaultId: string
    accountId: string
    secretId: string
    masterPassword: string
    onUpdate: () => void
    onClose: () => void
    onServiceUpdated?: () => void
}

const SecretModal = (props: SecretModalProps) => {

    const { open, vaultId, accountId, secretId, masterPassword, onUpdate, onClose } = props

    const getEmptySecret = (): ISecret => ({
        id: "",
        name: "",
        description: "",
        icon: "",
        content: "",
        vault: ""
    })

    const getEmptyForm = () => ({
        id: "",
        name: "",
        description: "",
        icon: "",
        content: "",
        vault: ""
    })

    const [ secret, setSecret ] = useState<ISecret>(getEmptySecret())
    const [ form, setForm ] = useState(getEmptyForm())

    const resetServiceState = () => {
        setSecret(getEmptySecret())
        setForm(getEmptyForm())
    }

    const saving = useRef(false)

    const handleSubmit = async (event: any) => {

        event.preventDefault()
        if (saving.current) return
        saving.current = true
        try {

        if(!form.content) return showAlert(t("Please fill in the required fields: Content"), "error", "alert-circle", 3000)

        await updateSecret({
            accountId,
            secretId,
            name: form.name,
            description: form.description,
            icon: form.icon,
            content: form.content,
            vault: form.vault || vaultId,
            masterPassword: masterPassword
        })

        showAlert(t("{{value0}} updated successfully!", { value0: form.name || t("Secret") }), 'success', 'check', 5000)
        
        onUpdate()
        onClose()

        } catch (error) {
            showAlert(error instanceof Error ? error.message : t("Could not save. Please retry."), "error", "alert-circle", 5000)
        } finally { saving.current = false }
    }

    const handleClose = () => {
        onClose()
    }

    const handleDelete = () => {

        if (!secretId) return

        const confirmation = confirm(t("Are you sure you want to delete this secret? This action cannot be undone."))
        if (!confirmation) return

        deleteSecret({
            accountId,
            secretId
        })

        showAlert(t("{{value0}} deleted successfully!", { value0: form.name || t("Secret") }), 'success', 'check', 5000)

        onUpdate()
        onClose()

    }

    const getSecretData = async () => {

        if (!secretId) {
            resetServiceState()
            return
        }

        const account = getStorage(accountId)
        const secret = account?.secrets?.find((secret: ISecret) => secret.id === secretId)

        if (!secret) { resetServiceState(); return }
        const content = await getSecretContent(secret.content, masterPassword)
        const description = await getSecretContent(secret.description, masterPassword)
            
        if(secret) {

            const nextForm = {
                id: secret.id,
                name: secret.name,
                icon: secret.icon,
                description: description,
                content: content,
                vault: secret.vault
            }

            setSecret(secret)
            setForm(nextForm)

            return
            
        }

        resetServiceState()

    }

    useEffect(() => {
        getSecretData().catch(() => {
            resetServiceState()
            showAlert(t("Could not decrypt this secret. Unlock the account again or restore a verified backup."), "error", "alert-circle", 5000)
            onClose()
        })
    }, [ accountId, secretId ])

    if(!secretId) return null

    return (
        <Dialog
            open={open}
            title={ secret.name || t("Secret") }
            onClose={onClose}
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
                            onClick: () => handleSubmit({ preventDefault: () => {} } as any)
                        }
                    ]}
                />
            }
        >
            <DialogOption
                title={t("Secret Name")}
                description={t("The name of the secret")}
                layout="row"
            >
                <Input
                    id="secret-name"
                    name="secret-name"
                    type="text"
                    value={ form.name }
                    placeholder={t("e.g. API key")}
                    onChange={ (event: any) => setForm({ ...form, name: event.target.value }) }
                    className="font-inter-medium h-fit w-full px-3 py-2 border duration-300 bg-white/5 border-white/20 focus:bg-white/10 focus:border-white/50 hover:bg-white/10 hover:border-white/50 hover:text-white squircle-md"
                />
            </DialogOption>
            <DialogOption
                title={t("Description")}
                description={t("Additional details about this secret")}
                layout="col"
            >
                <textarea
                    id="secret-description"
                    value={ form.description }
                    minLength={ 0 }
                    maxLength={ 300 }
                    rows={ 3 }
                    onChange={ (event: any) => setForm({ ...form, description: event.target.value }) }
                    className="font-inter-medium h-fit w-full px-3 py-2 border duration-300 bg-white/5 border-white/20 focus:bg-white/10 focus:border-white/50 hover:bg-white/10 hover:border-white/50 hover:text-white squircle squircle-sm"
                />
            </DialogOption>
            <DialogOption
                title={t("Vault")}
                description={t("Choose the vault for this secret")}
                layout="row"
                className="md:min-w-70 md:w-fit"
            >
                <Select
                    id="secret-vault"
                    options={ getVaultList(accountId) }
                    selected={ form.vault || vaultId }
                    onSelect={(event: any) => {
                        const newVault = event?.value ?? form.vault ?? vaultId;
                        setForm({ ...form, vault: newVault });
                    }}
                />
            </DialogOption>
            <DialogOption
                title={t("Icon")}
                description={t("Icon for the secret.")}
                layout="row"
                className="w-full md:min-w-70"
            >
                <IconSelector
                    value={ form.icon }
                    onChange={ (newIcon: string) => {
                        const newForm = { ...form, icon: newIcon }
                        setForm(newForm)
                    }}
                />
            </DialogOption>
            <DialogOption
                title={t("Secret Content")}
                description={t("The content to store in this secret")}
                layout="col"
            >
                <textarea
                    id="secret-content"
                    value={ form.content }
                    rows={ 6 }
                    onChange={ (event: any) => setForm({ ...form, content: event.target.value }) }
                    className="font-inter-medium h-fit w-full px-3 py-2 border duration-300 bg-white/5 border-white/20 focus:bg-white/10 focus:border-white/50 hover:bg-white/10 hover:border-white/50 hover:text-white squircle squircle-sm"
                />
            </DialogOption>
        </Dialog>
    )
}

export default SecretModal
