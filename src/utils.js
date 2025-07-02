// --- Utility Functions ---
export const formatIDR = (amount) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
export const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
export const formatTime = (timeString) => {
    if (!timeString) return '';
    const [hour, minute] = timeString.split(':');
    const hourNum = parseInt(hour);
    const ampm = hourNum >= 12 ? 'PM' : 'AM';
    const displayHour = hourNum > 12 ? hourNum - 12 : hourNum === 0 ? 12 : hourNum;
    return `${displayHour}:${minute.padStart(2, '0')} ${ampm}`;
};
export const getEndTime = (startTime, durationHours) => {
    if (!startTime || isNaN(durationHours)) return '';
    const [hour, minute] = startTime.split(':');
    const start = new Date();
    start.setHours(parseInt(hour), parseInt(minute), 0, 0);
    start.setHours(start.getHours() + durationHours);
    return `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
};
