import { t } from "@logic/i18n"
import { useEffect, useState } from "react"

import { getVault, updateVault, deleteVault } from "@logic/vault"
import { showAlert } from "@logic/alert"

import Input from "@component/ui/form/input"
import IconSelector from "@component/ui/form/icon"
import Dialog from "@component/ui/dialog/dialog"
import DialogOption from "@component/ui/dialog/option"
import DialogFooter from "@component/ui/dialog/footer"

type EditVaultModalProps = {
    open: boolean
    accountId: string
    vaultId: string
    onUpdate: () => void
    onClose: () => void
}

const EditVaultModal = (props: EditVaultModalProps) => {

    const { open, accountId, vaultId, onUpdate, onClose } = props

    const getEmptyVaultForm = () => ({
        name: '',
        icon: 'vault'
    })

    const [ vaultForm, setVaultForm ] = useState(getEmptyVaultForm())

    useEffect(() => {
        if (!open || !accountId || !vaultId) {
            setVaultForm(getEmptyVaultForm())
            return
        }

        const vault = getVault({ accountId, vaultId })

        if (vault) {
            setVaultForm({
                name: vault.name || '',
                icon: vault.icon || 'vault'
            })
            return
        }

        setVaultForm(getEmptyVaultForm())
    }, [ open, accountId, vaultId ])

    const handleClose = () => {
        setVaultForm(getEmptyVaultForm())
        onClose()
    }

    const handleSubmit = () => {

        if (!vaultForm.name.trim()) {
            return showAlert(t("Please fill in the vault name."), "error", "alert-circle", 3000)
        }

        try {
            updateVault({
                accountId,
                vaultId,
                vaultName: vaultForm.name,
                vaultIcon: vaultForm.icon
            })

            showAlert(t("{{value0}} vault updated successfully!", { value0: vaultForm.name }), 'success', 'check', 5000)

            setVaultForm(getEmptyVaultForm())
            onUpdate()
            onClose()

        } catch (error) {
            showAlert(t("Error updating vault. Please try again."), "error", "alert-circle", 3000)
            console.error("Error updating vault:", error)
        }
    }

    const handleDelete = () => {

        if (!vaultId) return

        const confirmed = window.confirm(
            t("Are you sure you want to delete this vault and all of its services and secrets? This action cannot be undone.")
        )

        if (!confirmed) return

        try {
            deleteVault({ accountId, vaultId })
            showAlert(t("{{value0}} deleted successfully!", { value0: vaultForm.name || t("Vault") }), 'success', 'check', 5000)
            setVaultForm(getEmptyVaultForm())
            onUpdate()
            onClose()
        } catch (error) {
            showAlert(t("Error deleting vault. Please try again."), "error", "alert-circle", 3000)
            console.error("Error deleting vault:", error)
        }
    }

    return (
        <Dialog
            open={open}
            title={t("Edit Vault")}
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
                title={t("Vault Name")}
                description={t("Update the display name for this vault")}
                layout="row"
            >
                <Input
                    id="vault-name"
                    name="vault-name"
                    type="text"
                    value={vaultForm.name}
                    placeholder={t("e.g. My Personal Vault")}
                    onChange={(event: any) => {
                        setVaultForm({ ...vaultForm, name: event.target.value })
                    }}
                    className="font-inter-medium h-fit w-full px-3 py-2 border duration-300 bg-white/5 border-white/20 focus:bg-white/10 focus:border-white/50 hover:bg-white/10 hover:border-white/50 hover:text-white squircle-md"
                />
            </DialogOption>

            <DialogOption
                title={t("Vault Icon")}
                description={t("Select a new icon for the vault")}
                layout="row"
            >
                <IconSelector
                    value={vaultForm.icon}
                    onChange={(value: string) => {
                        setVaultForm({ ...vaultForm, icon: value })
                    }}
                />
            </DialogOption>
        </Dialog>
    )
}

export default EditVaultModal
